import { isIP } from 'node:net';

export function publicIp(ip) {
  ip = ip.replace(/^::ffff:/, '');
  if (!isIP(ip)) return false;
  if (ip.includes(':')) return !/^(::|fc|fd|fe8|fe9|fea|feb|2001:db8)/i.test(ip);
  const [a,b] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
}
export function geoProviders(config) {
  if (config.geoMode === 'mock') return [
    async () => { if (config.geoADown) throw new Error('Provider A unavailable'); return { country: 'India', country_code: 'IN', city: 'Bengaluru', provider: 'mock-a' }; },
    async () => { if (config.geoBDown) throw new Error('Provider B unavailable'); return { country: 'India', country_code: 'IN', city: 'Mumbai', provider: 'mock-b' }; },
  ];
  const get = async url => {
    const r = await fetch(url, { signal: AbortSignal.timeout(1800) });
    if (!r.ok) throw new Error('Geo provider unavailable'); return r.json();
  };
  return [
    async ip => {
      // Free ip-api uses HTTP: an explicit privacy limitation documented in README.
      const d = await get(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,city`);
      if (d.status !== 'success') throw new Error('Geo lookup failed');
      return { country: d.country, country_code: d.countryCode, city: d.city, provider: 'ip-api' };
    },
    async ip => {
      const d = await get(`https://ipapi.co/${encodeURIComponent(ip)}/json/`);
      if (d.error) throw new Error('Geo lookup failed');
      return { country: d.country_name, country_code: d.country_code, city: d.city, provider: 'ipapi' };
    },
  ];
}
export async function enrich(ip, providers, mode) {
  if (mode === 'live' && !publicIp(ip)) return null;
  for (const provider of providers) {
    try {
      const geo = await provider(ip);
      if (geo && typeof geo.country === 'string' && typeof geo.city === 'string' && typeof geo.provider === 'string') return geo;
    } catch { /* Availability boundary: a failed dependency never rejects a lead. */ }
  }
  return null;
}
