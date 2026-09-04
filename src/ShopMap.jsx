import React, { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { shopHasCoords } from './geocode';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = [28.5383, -81.3792];
const DEFAULT_ZOOM = 11;

export const PIN_COLOR = {
  visited: '#0f6e56',
  follow_up: '#ba7517',
  not_visited: '#7a7974',
  no_interest: '#a32d2d',
};

function InvalidateAndFit({ shops, fallbackCenter, fallbackZoom }) {
  const map = useMap();
  const key = shops.map((s) => `${s.id}:${Number(s.lat).toFixed(5)}:${Number(s.lng).toFixed(5)}`).join('|');
  const emptyCenter = fallbackCenter || DEFAULT_CENTER;
  const emptyZoom = fallbackZoom ?? DEFAULT_ZOOM;

  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 80);
    return () => clearTimeout(timer);
  }, [map]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!shops.length) {
        map.setView(emptyCenter, emptyZoom);
        return;
      }
      if (shops.length === 1) {
        map.setView([shops[0].lat, shops[0].lng], 15);
        return;
      }
      map.fitBounds(
        shops.map((s) => [s.lat, s.lng]),
        { padding: [40, 40], maxZoom: 14 },
      );
    }, 350);
    return () => clearTimeout(timer);
  }, [key, map, shops, emptyCenter, emptyZoom]);

  return null;
}

function PanIfHidden({ shops, focusId }) {
  const map = useMap();
  useEffect(() => {
    if (!focusId) return;
    const shop = shops.find((s) => s.id === focusId);
    if (!shopHasCoords(shop)) return;
    const point = { lat: Number(shop.lat), lng: Number(shop.lng) };
    if (!map.getBounds().contains(point)) map.panTo(point, { animate: true });
  }, [focusId, map, shops]);
  return null;
}

export default function ShopMap({ shops, hoveredId, statusLabels, onHover, onOpen, fallbackCenter, fallbackZoom }) {
  const mapped = useMemo(
    () => shops.filter(shopHasCoords).map((s) => ({ ...s, lat: Number(s.lat), lng: Number(s.lng) })),
    [shops],
  );
  const emptyCenter = fallbackCenter || DEFAULT_CENTER;
  const emptyZoom = fallbackZoom ?? DEFAULT_ZOOM;

  return (
    <div className="shop-map">
      <MapContainer
        center={emptyCenter}
        zoom={emptyZoom}
        scrollWheelZoom
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <InvalidateAndFit shops={mapped} fallbackCenter={emptyCenter} fallbackZoom={emptyZoom} />
        <PanIfHidden shops={mapped} focusId={hoveredId} />
        {mapped.map((shop) => {
          const active = hoveredId === shop.id;
          return (
            <CircleMarker
              key={shop.id}
              center={[shop.lat, shop.lng]}
              radius={active ? 13 : shop.starred ? 10 : 8}
              pathOptions={{
                color: shop.starred || active ? '#ba7517' : '#fff',
                weight: active ? 3 : 2,
                fillColor: PIN_COLOR[shop.status] || PIN_COLOR.not_visited,
                fillOpacity: 0.95,
              }}
              eventHandlers={{
                mouseover: () => onHover(shop.id),
                mouseout: () => onHover(null),
                click: () => onOpen(shop),
              }}
            >
              <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                <div className="map-tip">
                  <strong>{shop.name}</strong>
                  <span>{statusLabels[shop.status] || '未选择'}{shop.tier ? ` · ${shop.tier}` : ''}</span>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="map-legend">
        {Object.entries(statusLabels).map(([key, label]) => (
          <span key={key}>
            <i style={{ background: PIN_COLOR[key] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
