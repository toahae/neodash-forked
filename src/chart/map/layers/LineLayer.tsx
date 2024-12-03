import React from 'react';
import { Polyline, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-polylinedecorator';
import L from 'leaflet';
import { Typography } from '@neo4j-ndl/react';

export function createLines(data) {
  function createPopupFromRelProperties(value) {
    return (
      <Popup className={'leaflet-custom-rel-popup'}>
        <Typography variant='h4'>
          <b>{value.type}</b>
        </Typography>
        <table>
          <tbody>
            {Object.keys(value.properties).length === 0 ? (
              <tr>
                <td>(No properties)</td>
              </tr>
            ) : (
              Object.keys(value.properties).map((k, i) => (
                <tr key={i}>
                  <td style={{ marginRight: '10px' }} key={0}>
                    {k.toString()}:
                  </td>
                  <td key={1}>{value.properties[k].toString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Popup>
    );
  }

  // Helper component for PolylineDecorator
  const ArrowDecorator = ({ positions, color }) => {
    const map = useMap();

    React.useEffect(() => {
      const decorator = L.polylineDecorator(L.polyline(positions), {
        patterns: [
          {
            offset: '50%', // Position the arrow at the midpoint
            repeat: 0, // Only one arrow
            symbol: L.Symbol.arrowHead({
              pixelSize: 10,
              polygon: true,
              pathOptions: { color, fillColor: color, fillOpacity: 1 },
            }),
          },
        ],
      });

      map.addLayer(decorator);

      // Cleanup when the component unmounts
      return () => {
        map.removeLayer(decorator);
      };
    }, [map, positions, color]);

    return null;
  };

  // Create lines to plot on the map.
  return data.links
    .filter((link) => link)
    .map((rel, i) => {
      if (rel.start && rel.end) {
        const positions = [rel.start, rel.end];

        return (
          <>
            <Polyline weight={rel.width} key={`line-${i}`} positions={positions} color={rel.color}>
              {createPopupFromRelProperties(rel)}
            </Polyline>
            <ArrowDecorator key={`arrow-${i}`} positions={positions} color={rel.color} />
          </>
        );
      }
    });
}
