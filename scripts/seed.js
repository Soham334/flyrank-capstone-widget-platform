import { randomUUID } from 'node:crypto';
import { config } from '../src/config.js';
import { openDatabase, transaction, now } from '../src/database.js';
import { passwordHash } from '../src/security.js';

export async function seed(db){
  const email='demo@relay.local';
  if(db.prepare('SELECT id FROM tenants WHERE email=?').get(email)){console.log('Demo workspace already exists; seed did not modify your data.');return;}
  const owner=randomUUID(), other=randomUUID(), password=await passwordHash('RelayDemo!2026');
  const widgets=[
    {id:randomUUID(),name:'The weekly edit',type:'signup',title:'Good things, in your inbox.',description:'A little inspiration. The occasional update. Always worth opening.',button:'Keep me in the loop',color:'#7957e8'},
    {id:randomUUID(),name:'Let’s work together',type:'contact',title:'Great ideas start with hello.',description:'Have something in mind? We’d love to hear about it.',button:'Start a conversation',color:'#568e7c'},
    {id:randomUUID(),name:'A little hello',type:'popover',title:'A fresh perspective, weekly.',description:'Join our community of curious minds.',button:'Count me in',color:'#bc906d'},
  ];
  const names=[['Aarav Sharma','India','Bengaluru'],['Sophie Chen','Singapore','Singapore'],['Oliver Wilson','United Kingdom','London'],['Mia Thompson','United States','Austin'],['Ananya Patel','India','Mumbai'],['Noah Martin','Canada','Toronto'],['Isabella Rossi','Italy','Milan'],['Leo Dubois','France','Paris'],['Riya Kapoor','India','Delhi'],['Ethan Park','South Korea','Seoul'],['Amelia Smith','Australia','Sydney'],['Lucas Silva','Brazil','São Paulo']];
  transaction(db,()=>{
    db.prepare('INSERT INTO tenants VALUES (?,?,?,?,?)').run(owner,'Acme Studio',email,password,now());
    db.prepare('INSERT INTO tenants VALUES (?,?,?,?,?)').run(other,'Other Tenant','other@relay.local',password,now());
    for(const w of widgets){const fields=[{name:'name',label:'Your name',type:'text',required:true},{name:'email',label:'Email address',type:'email',required:true}];if(w.type==='contact')fields.push({name:'message',label:'What’s on your mind?',type:'textarea',required:false});
      db.prepare('INSERT INTO widgets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(w.id,owner,w.name,w.type,w.title,w.description,w.button,w.color,JSON.stringify(fields),1,JSON.stringify({path:'',delay:0,once:false}),now(),now());}
    // Deliberately separate second tenant for a manual isolation demonstration.
    db.prepare('INSERT INTO widgets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),other,'Private widget','signup','Another workspace','Private tenant data','Join','#7957e8',JSON.stringify([{name:'email',label:'Email',type:'email',required:true}]),1,JSON.stringify({path:'',delay:0,once:false}),now(),now());
    for(let day=29;day>=0;day--){const count=day===0?6:2+((day*7+3)%10);for(let i=0;i<count;i++){
      const idx=(day*5+i)%names.length,[name,country,city]=names[idx],w=widgets[(day+i)%3],id=randomUUID();
      const time=new Date(Date.now()-day*86400000-(i*37+4)*60000).toISOString();
      const data={name,email:name.toLowerCase().replaceAll(' ','.')+'@example.com'};if(w.type==='contact')data.message='I’d love to learn more about working together.';
      db.prepare('INSERT INTO submissions (id,widget_id,tenant_id,data,geo,source,consent,consent_text,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,w.id,owner,JSON.stringify(data),JSON.stringify({country,city,provider:'seed-fixture'}),'http://localhost:5500/',1,'I agree to be contacted about my request.',['new','contacted','qualified'][i%3],time);
      db.prepare('INSERT INTO jobs (id,tenant_id,submission_id,status,attempts,available_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),owner,id,'delivered',1,Date.now(),time,time);
    }}
    db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?)').run(randomUUID(),owner,'demo.seeded',owner,now());
  });
  console.log('Seeded fictional demo data. Email: demo@relay.local | Password: RelayDemo!2026');
  console.log(`Customer demo: http://localhost:5500/?widget=${widgets[0].id}`);
}
if(process.argv[1]&&new URL(import.meta.url).pathname.toLowerCase().endsWith(process.argv[1].replaceAll('\\','/').split('/').slice(-2).join('/').toLowerCase())){
  const db=openDatabase(config().databasePath);try{await seed(db);}finally{db.close();}
}
