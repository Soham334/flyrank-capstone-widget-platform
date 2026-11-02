import { createApp } from './app.js';
import { config } from './config.js';
const settings=config();
let dependencies={};
if(settings.databaseUrl){
  const {openPostgres}=await import('./postgres.js');
  try{dependencies=await openPostgres(settings.databaseUrl);}catch{console.error('Hosted database startup failed. Check DATABASE_URL and network access.');process.exit(1);}
}
if(process.env.RENDER==='true'&&!settings.databaseUrl){console.error('DATABASE_URL is required on Render to avoid losing leads on restart.');process.exit(1);}
const app = createApp({},dependencies);
await app.worker.ready;
app.server.listen(app.config.port,app.config.host,() => console.log(`Relay dashboard: ${app.config.baseUrl} | Geo: ${app.config.geoMode}`));
let closing = false;
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async () => { if (closing) return; closing=true; await app.close(); process.exit(0); });
