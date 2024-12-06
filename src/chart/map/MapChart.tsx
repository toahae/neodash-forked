import React, { useEffect, useState } from 'react';
import { ChartProps } from '../Chart';
import { categoricalColorSchemes } from '../../config/ColorConfig';
import { valueIsArray, valueIsNode, valueIsRelationship, valueIsPath, valueIsObject } from '../../chart/ChartUtils';
import { MapContainer, TileLayer, FeatureGroup, useMapEvents } from 'react-leaflet';
import { EditControl } from 'react-leaflet-draw';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import { evaluateRulesOnNode, useStyleRules } from '../../extensions/styling/StyleRuleEvaluator';
import { createHeatmap } from './layers/HeatmapLayer';
import { createMarkers } from './layers/MarkerLayer';
import { createLines } from './layers/LineLayer';
import { extensionEnabled } from '../../utils/ReportUtils';

const update = (state, mutations) => Object.assign({}, state, mutations);

/**
 * Renders Neo4j records as their JSON representation.
 */
const NeoMapChart = (props: ChartProps) => {
  // Retrieve config from advanced settings
  const layerType = props.settings && props.settings.layerType ? props.settings.layerType : 'markers';
  const nodeColorProp = props.settings && props.settings.nodeColorProp ? props.settings.nodeColorProp : 'color';
  const defaultNodeSize = props.settings && props.settings.defaultNodeSize ? props.settings.defaultNodeSize : 'large';
  const relWidthProp = props.settings && props.settings.relWidthProp ? props.settings.relWidthProp : 'width';
  const relColorProp = props.settings && props.settings.relColorProp ? props.settings.relColorProp : 'color';
  const defaultRelWidth = props.settings && props.settings.defaultRelWidth ? props.settings.defaultRelWidth : 3.5;
  const defaultRelColor = props.settings && props.settings.defaultRelColor ? props.settings.defaultRelColor : '#666';
  const nodeColorScheme = props.settings && props.settings.nodeColorScheme ? props.settings.nodeColorScheme : 'neodash';
  const filterQuery = props.settings && props.settings.filterQuery ? props.settings.filterQuery : 'MATCH (n)-[r]->(m)';
  const styleRules = useStyleRules(
    extensionEnabled(props.extensions, 'styling'),
    props.settings.styleRules,
    props.getGlobalParameter
  );
  const defaultNodeColor = 'grey'; // Color of nodes without labels
  const dimensions = props.dimensions ? props.dimensions : { width: 100, height: 100 };
  const mapProviderURL =
    props.settings && props.settings.providerUrl
      ? props.settings.providerUrl
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const attribution =
    props.settings && props.settings.attribution
      ? props.settings.attribution
      : '&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors';

  const actionsRules =
    extensionEnabled(props.extensions, 'actions') && props.settings && props.settings.actionsRules
      ? props.settings.actionsRules
      : [];

  const [data, setData] = React.useState({ nodes: [], links: [], zoom: 0, centerLatitude: 0, centerLongitude: 0 });
  const [shouldRerender, setShouldRerender] = useState(false); // New state variable
  // Effect to handle rerendering logic
  useEffect(() => {
    if (shouldRerender) {
      setShouldRerender(false);
    }
  }, [shouldRerender]);
  // Per pixel, scaling factors for the latitude/longitude mapping function.
  const widthScale = 8.55;
  const heightScale = 6.7;

  let key = `${dimensions.width},${dimensions.height},${data.centerLatitude},${data.centerLongitude},${props.fullscreen}`;
  useEffect(() => {
    `${data.centerLatitude},${data.centerLongitude},${props.fullscreen}`;
  }, [props.fullscreen]);

  useEffect(() => {
    buildVisualizationDictionaryFromRecords(props.records);
  }, []);

  let nodes = {};
  let nodeLabels = {};
  let links = {};
  let linkTypes = {};

  // Gets all graphy objects (nodes/relationships) from the complete set of return values.
  // TODO this should be in Utils.ts
  function extractGraphEntitiesFromField(value) {
    if (value == undefined) {
      return;
    }
    if (valueIsArray(value)) {
      value.forEach((v) => extractGraphEntitiesFromField(v));
    } else if (valueIsObject(value)) {
      if (value.label && value.id) {
        // Override for adding point nodes using a manually constructed dict.
        nodeLabels[value.label] = true;
        nodes[value.id] = {
          id: value.id,
          labels: [value.label],
          size: defaultNodeSize,
          properties: value,
          firstLabel: value.label,
        };
      } else if (value.type && value.id && value.start && value.end) {
        // Override for adding relationships using a manually constructed dict.
        if (links[`${value.start},${value.end}`] == undefined) {
          links[`${value.start},${value.end}`] = [];
        }
        const addItem = (arr, item) => arr.find((x) => x.id === item.id) || arr.push(item);
        addItem(links[`${value.start},${value.end}`], {
          id: value.id,
          source: value.start,
          target: value.end,
          type: value.type,
          width: value[relWidthProp] ? value[relWidthProp] : defaultRelWidth,
          color: value[relColorProp] ? value[relColorProp] : defaultRelColor,
          properties: value,
        });
      }
    } else if (valueIsNode(value)) {
      value.labels.forEach((l) => (nodeLabels[l] = true));
      nodes[value.identity.low] = {
        id: value.identity.low,
        labels: value.labels,
        size: defaultNodeSize,
        properties: value.properties,
        firstLabel: value.labels[0],
      };
    } else if (valueIsRelationship(value)) {
      if (links[`${value.start.low},${value.end.low}`] == undefined) {
        links[`${value.start.low},${value.end.low}`] = [];
      }
      const addItem = (arr, item) => arr.find((x) => x.id === item.id) || arr.push(item);
      addItem(links[`${value.start.low},${value.end.low}`], {
        id: value.identity.low,
        source: value.start.low,
        target: value.end.low,
        type: value.type,
        width: value.properties[relWidthProp] ? value.properties[relWidthProp] : defaultRelWidth,
        color: value.properties[relColorProp] ? value.properties[relColorProp] : defaultRelColor,
        properties: value.properties,
      });
    } else if (valueIsPath(value)) {
      value.segments.map((segment) => {
        extractGraphEntitiesFromField(segment.start);
        extractGraphEntitiesFromField(segment.relationship);
        extractGraphEntitiesFromField(segment.end);
      });
    }
  }

  // TODO this should be in Utils.ts
  function buildVisualizationDictionaryFromRecords(records) {
    // Extract graph objects from result set.
    records.forEach((record) => {
      record._fields &&
        record._fields.forEach((field) => {
          extractGraphEntitiesFromField(field);
        });
    });

    // Assign proper colors & coordinates to nodes.
    const totalColors = categoricalColorSchemes[nodeColorScheme].length;
    const nodeLabelsList = Object.keys(nodeLabels);
    const nodesList = Object.values(nodes).map((node) => {
      const assignPosition = (node) => {
        if (node.properties.latitude && node.properties.longitude) {
          nodes[node.id].pos = [parseFloat(node.properties.latitude), parseFloat(node.properties.longitude)];
          return nodes[node.id].pos;
        }
        if (node.properties.lat && node.properties.long) {
          nodes[node.id].pos = [parseFloat(node.properties.lat), parseFloat(node.properties.long)];
          return nodes[node.id].pos;
        }
        Object.values(node.properties).forEach((p) => {
          if (p != null && p.srid != null && p.x != null && p.y != null) {
            if (!isNaN(p.x) && !isNaN(p.y)) {
              nodes[node.id].pos = [p.y, p.x];
              return [p.y, p.x];
            }
          }
        });
      };

      let assignedColor = node.properties[nodeColorProp]
        ? node.properties[nodeColorProp]
        : categoricalColorSchemes[nodeColorScheme][nodeLabelsList.indexOf(node.firstLabel) % totalColors];

      assignedColor = evaluateRulesOnNode(node, 'marker color', assignedColor, styleRules);
      const assignedPos = assignPosition(node);
      return update(node, {
        pos: node.pos ? node.pos : assignedPos,
        color: assignedColor ? assignedColor : defaultNodeColor,
      });
    });

    // Assign proper curvatures to relationships.
    const linksList = Object.values(links)
      .map((nodePair) => {
        return nodePair.map((link) => {
          if (nodes[link.source] && nodes[link.source].pos && nodes[link.target] && nodes[link.target].pos) {
            return update(link, { start: nodes[link.source].pos, end: nodes[link.target].pos });
          }
        });
      })
      .flat();

    // Calculate center latitude and center longitude:

    const latitudes = nodesList.reduce((a, b) => {
      if (b.pos == undefined) {
        return a;
      }
      a.push(b.pos[0]);
      return a;
    }, []);
    const longitudes = nodesList.reduce((a, b) => {
      if (b.pos == undefined) {
        return a;
      }
      a.push(b.pos[1]);
      return a;
    }, []);
    const maxLat = Math.max(...latitudes);
    const minLat = Math.min(...latitudes);
    const avgLat = maxLat - (maxLat - minLat) / 2.0;

    let latWidthScaleFactor = (dimensions.width ? dimensions.width : 300) / widthScale;
    let latDiff = maxLat - avgLat;
    let latProjectedWidth = latDiff / latWidthScaleFactor;
    let latZoomFit = Math.ceil(Math.log2(1.0 / latProjectedWidth));

    const maxLong = Math.min(...longitudes);
    const minLong = Math.min(...longitudes);
    const avgLong = maxLong - (maxLong - minLong) / 2.0;

    let longHeightScaleFactor = (dimensions.height ? dimensions.height : 300) / heightScale;
    let longDiff = maxLong - avgLong;
    let longProjectedHeight = longDiff / longHeightScaleFactor;
    let longZoomFit = Math.ceil(Math.log2(1.0 / longProjectedHeight));
    // Set data based on result values.
    let dataSet = {
      zoom: Math.min(latZoomFit, longZoomFit),
      centerLatitude: latitudes ? latitudes.reduce((a, b) => a + b, 0) / latitudes.length : 0,
      centerLongitude: longitudes ? longitudes.reduce((a, b) => a + b, 0) / longitudes.length : 0,
      nodes: nodesList,
      links: linksList,
    };
    setData(dataSet);
    return dataSet;
  }

  const onCreated = (e) => {
    const { layerType, layer } = e;

    if (layerType === 'circle') {
      const radius = layer.getRadius();
      const center = layer.getLatLng();
      handleGeoFilter({ lat: center.lat, lon: center.lng }, radius, 'circle');
    } else if (layerType === 'rectangle') {
      const bounds = layer.getBounds();
      const topLeft = bounds.getNorthWest();
      const bottomRight = bounds.getSouthEast();
      handleGeoFilter({ topLeft, bottomRight }, null, 'rectangle');
    } else if (layerType === 'polygon' || layerType === 'polyline') {
      const latLngs = layer.getLatLngs(); // Array of LatLng points
      handleGeoFilter({ points: latLngs }, null, layerType);
    }
  };

  const handleGeoFilter = (filterData, radius, type) => {
    let geoLocationQuery;

    if (type === 'circle') {
      const { lat, lon } = filterData;
      geoLocationQuery = `
      ${filterQuery}
      WHERE point.distance(n.location, point({latitude: ${lat}, longitude: ${lon}})) <= ${radius}
      RETURN n, r, m
    `;
    } else if (type === 'rectangle') {
      const { topLeft, bottomRight } = filterData;
      const latMin = bottomRight.lat;
      const latMax = topLeft.lat;
      const lonMin = topLeft.lng;
      const lonMax = bottomRight.lng;

      geoLocationQuery = `
      ${filterQuery}
      WHERE 
        n.location.latitude >= ${latMin} AND n.location.latitude <= ${latMax} AND
        n.location.longitude >= ${lonMin} AND n.location.longitude <= ${lonMax}
      RETURN n, r, m
    `;
    } else if (type === 'polygon') {
      const { points } = filterData;
      const polygonPoints = points[0].map((point) => `{latitude: ${point.lat}, longitude: ${point.lng}}`).join(', ');

      geoLocationQuery = `
      ${filterQuery}
      WHERE point.inPolygon(n.location, [${polygonPoints}])
      RETURN n, r, m
    `;
    } else if (type === 'polyline') {
      const { points } = filterData;
      const linePoints = points.map((point) => `{latitude: ${point.lat}, longitude: ${point.lng}}`).join(', ');

      geoLocationQuery = `
      ${filterQuery}
      WHERE ANY(p IN [${linePoints}] WHERE point.distance(n.location, point(p)) <= ${radius || 500})
      RETURN n, r, m
    `;
    }

    if (props.queryCallback) {
      props.queryCallback(geoLocationQuery, {}, (updated_records) => {
        buildVisualizationDictionaryFromRecords(updated_records);
        setShouldRerender(true);
      });

      // if (props.createNotification) {
      //   props.createNotification('Query Updated', `${type} geo-location filter applied.`);
      // }
    }
  };

  const onDeleted = () => {
    props.queryCallback(props.query, {}, (records) => {
      buildVisualizationDictionaryFromRecords(records);
      setShouldRerender(true);
    });
  };

  const MouseCoordinates = () => {
    const [coords, setCoords] = useState({ lat: 0, lng: 0 });

    // Hook to listen for mouse movements
    useMapEvents({
      mousemove: (e) => {
        setCoords({
          lat: e.latlng.lat.toFixed(5), // Limit to 5 decimal places for better readability
          lng: e.latlng.lng.toFixed(5),
        });
      },
    });

    return (
      <div
        style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          backgroundColor: 'white',
          padding: '5px',
          zIndex: 1000,
        }}
      >
        Lat: {coords.lat}, Lng: {coords.lng}
      </div>
    );
  };

  // TODO this should definitely be refactored as an if/case statement.
  const markers = layerType == 'markers' ? createMarkers(data, props) : '';
  const lines = layerType == 'markers' ? createLines(data) : '';
  const heatmap = layerType == 'heatmap' ? createHeatmap(data, props) : '';
  // Draw the component.
  // Ideally, we want to have one component for each layer on the map, different files
  // https://stackoverflow.com/questions/69751481/i-want-to-use-useref-to-access-an-element-in-a-reat-leaflet-and-use-the-flyto
  return (
    <MapContainer
      key={key}
      style={{ width: '100%', height: '100%' }}
      center={[data.centerLatitude ? data.centerLatitude : 0, data.centerLongitude ? data.centerLongitude : 0]}
      zoom={data.zoom ? data.zoom : 0}
      maxZoom={18}
      scrollWheelZoom={true}
    >
      {heatmap}
      <TileLayer attribution={attribution} url={mapProviderURL ? mapProviderURL : ''} />
      {markers}
      {lines}
      <FeatureGroup>
        <EditControl
          position='topright'
          draw={{
            rectangle: true,
            polygon: true,
            polyline: true,
            marker: false,
            circlemarker: false,
          }}
          onCreated={onCreated}
          onDeleted={onDeleted}
        />
      </FeatureGroup>
      <MouseCoordinates />
    </MapContainer>
  );
};

export default NeoMapChart;
