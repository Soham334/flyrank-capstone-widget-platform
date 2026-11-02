import { writeFileSync } from 'node:fs';
const ref=name=>({$ref:'#/components/schemas/'+name});
const string={type:'string'},object={type:'object'},boolean={type:'boolean'};
const json=schema=>({'application/json':{schema}});
const body=schema=>({required:true,content:json(schema)});
const id={name:'id',in:'path',required:true,schema:string};
const response=(description,schema)=>({description,...(schema?{content:json(schema)}:{})});
const errors=Object.fromEntries([400,401,403,404,409,413,415,422,429,500].map(code=>[code,response('JSON error; see API.md',ref('Error'))]));
function op(summary,{schema=object,status=200,input,publicRoute=false,parameters=[],kind='json'}={}){
  return {summary,...(publicRoute?{security:[]}:{}),...(parameters.length?{parameters}:{}),...(input?{requestBody:body(input)}:{}),responses:{[status]:kind==='empty'?response('Success'):kind==='csv'?{description:'CSV export (max 10,000 rows)',content:{'text/csv':{schema:string}}}:kind==='sse'?{description:'Tenant-scoped ready / change events',content:{'text/event-stream':{schema:string}}}:response('Success',schema),...errors}};
}
const field={type:'object',additionalProperties:false,required:['name','label','type','required'],properties:{name:{type:'string',pattern:'^[a-z][a-z0-9_]{0,29}$'},label:{type:'string',minLength:1,maxLength:60},type:{enum:['text','email','textarea','tel']},required:boolean}};
const widgetProperties={name:{type:'string',minLength:1,maxLength:80},type:{enum:['signup','contact','popover']},title:{type:'string',minLength:1,maxLength:100},description:{type:'string',maxLength:400},button_text:{type:'string',minLength:1,maxLength:40},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},fields:{type:'array',minItems:1,maxItems:8,items:field},active:boolean,targeting:{type:'object',additionalProperties:false,required:['path','delay','once'],properties:{path:{type:'string',maxLength:200},delay:{type:'integer',minimum:0,maximum:60},once:boolean}}};
const auth={type:'object',additionalProperties:false,required:['email','password'],properties:{email:{type:'string',format:'email'},password:{type:'string',minLength:10,maxLength:128}}};
const query=(name,schema)=>({name,in:'query',schema});
const filters=[query('q',{type:'string',maxLength:100}),query('widget_id',string),query('status',{enum:['new','contacted','qualified','archived']}),query('page',{type:'integer',minimum:1,maximum:100000,default:1}),query('limit',{type:'integer',minimum:1,maximum:100,default:20})];
const spec={openapi:'3.1.0',info:{title:'Relay lead-capture API',version:'1.0.0',description:'Tenant-isolated owner API and public embeddable lead capture. Local capstone, Node 24 / SQLite. Read docs/API.md for limits, failure controls and complete semantics.'},servers:[{url:'http://localhost:4100'}],security:[{session:[]}],paths:{
  '/health':{get:op('Liveness and database readiness',{publicRoute:true})},
  '/api/auth/register':{post:op('Create workspace and set session cookie',{publicRoute:true,status:201,input:{...auth,required:['name','email','password'],properties:{...auth.properties,name:{type:'string',minLength:1,maxLength:80}}},schema:ref('User')})},
  '/api/auth/login':{post:op('Sign in and set session cookie',{publicRoute:true,input:auth,schema:ref('User')})},
  '/api/auth/me':{get:op('Current session owner',{schema:ref('User')})},
  '/api/auth/logout':{post:op('Revoke session and clear cookie')},
  '/api/widgets':{get:op('List tenant widgets',{schema:{type:'object',properties:{items:{type:'array',items:ref('Widget')}}}}),post:op('Create widget',{status:201,input:ref('WidgetCreate'),schema:ref('Widget')})},
  '/api/widgets/{id}':{parameters:[id],get:op('Read owner widget',{schema:ref('Widget')}),patch:op('Update supplied widget fields',{input:ref('WidgetPatch'),schema:ref('Widget')}),put:op('Update supplied widget fields (partial PUT semantics)',{input:ref('WidgetPatch'),schema:ref('Widget')}),delete:op('Delete widget, leads and jobs',{status:204,kind:'empty'})},
  '/api/widgets/{id}/snippet':{parameters:[id],get:op('Generate one-line embed snippet',{schema:{type:'object',properties:{snippet:string}}})},
  '/api/widgets/{id}/config':{parameters:[id],get:{...op('Public configuration; 30s cache and ETag',{publicRoute:true}),responses:{200:{...response('Public configuration'),headers:{'Cache-Control':{schema:string},ETag:{schema:string}}},304:response('ETag unchanged'),404:errors[404]}},options:op('Public config preflight',{publicRoute:true,status:204,kind:'empty'})},
  '/widget.v1.js':{get:{summary:'Immutable versioned widget script',security:[],parameters:[query('id',string)],responses:{200:{description:'JavaScript bundle',headers:{'Cache-Control':{schema:{type:'string',const:'public, max-age=31536000, immutable'}}},content:{'text/javascript':{schema:string}}}}}},
  '/widget.js':{get:{summary:'Redirect to versioned widget script',security:[],parameters:[query('id',string)],responses:{302:{description:'Versioned bundle redirect',headers:{Location:{schema:string}}}}}},
  '/api/submissions':{options:op('Cross-origin preflight',{publicRoute:true,status:204,kind:'empty'}),post:{...op('Accept lead; replay 200; geo failure never rejects valid lead',{publicRoute:true,status:201,input:ref('LeadInput'),schema:ref('Acceptance'),parameters:[{name:'Idempotency-Key',in:'header',schema:{type:'string',minLength:8,maxLength:128}}]}),responses:{...op('').responses,201:response('New lead and notification intent committed',ref('Acceptance')),200:{...response('Idempotent replay',ref('Acceptance')),headers:{'Idempotency-Replayed':{schema:{const:'true'}}}}}}},
  '/api/dashboard':{get:op('Tenant metrics, time series, countries, widget counts and jobs')},
  '/api/leads':{get:op('Search and paginate tenant-owned leads',{parameters:filters,schema:{type:'object',properties:{items:{type:'array',items:ref('Lead')},total:{type:'integer'},page:{type:'integer'},limit:{type:'integer'}}}})},
  '/api/leads/export':{get:op('Export filtered leads as formula-safe CSV',{parameters:filters.slice(0,3),kind:'csv'})},
  '/api/leads/{id}':{parameters:[id],get:op('Read full lead and consent record',{schema:ref('Lead')}),patch:op('Change follow-up status',{input:{type:'object',additionalProperties:false,required:['status'],properties:{status:{enum:['new','contacted','qualified','archived']}}},schema:ref('Lead')}),delete:op('Delete lead personal data and associated job',{status:204,kind:'empty'})},
  '/api/jobs':{get:op('Latest 100 tenant-owned notification jobs')},
  '/api/jobs/{id}/retry':{parameters:[id],post:op('Requeue a tenant-owned dead-letter job')},
  '/api/audit':{get:op('Latest 100 tenant-owned owner audit events')},
  '/api/events':{get:op('Session-authenticated live update stream (5 connections per tenant)',{kind:'sse'})},
},components:{securitySchemes:{session:{type:'apiKey',in:'cookie',name:'relay_session'}},schemas:{
  Error:{type:'object',required:['error','request_id'],properties:{error:string,request_id:{type:'string',format:'uuid'},details:{type:'array',items:string}}},
  User:{type:'object',properties:{id:string,name:string,email:string}},
  WidgetCreate:{type:'object',additionalProperties:false,required:['name','title'],properties:widgetProperties},
  WidgetPatch:{type:'object',additionalProperties:false,properties:widgetProperties},
  Widget:{type:'object',properties:{id:string,tenant_id:string,...widgetProperties,created_at:{type:'string',format:'date-time'},updated_at:{type:'string',format:'date-time'},leads:{type:'integer'}}},
  Geo:{type:['object','null'],properties:{country:string,country_code:string,city:string,provider:string}},
  LeadInput:{type:'object',additionalProperties:false,required:['widget_id','data','consent'],properties:{widget_id:{type:'string',maxLength:80},data:{type:'object',additionalProperties:{type:'string'}},website:{type:'string',description:'Honeypot; must be empty'},consent:{const:true},source:{type:'string',maxLength:500}}},
  Acceptance:{type:'object',properties:{id:string,widget_id:string,accepted:{const:true},geo:ref('Geo')}},
  Lead:{type:'object',properties:{id:string,widget_id:string,tenant_id:string,widget_name:string,data:object,geo:ref('Geo'),source:string,consent:boolean,consent_text:string,status:{enum:['new','contacted','qualified','archived']},created_at:{type:'string',format:'date-time'}}},
}}};
writeFileSync(new URL('../docs/openapi.json',import.meta.url),JSON.stringify(spec,null,2)+'\n');
console.log('Generated docs/openapi.json');
