const query=new URLSearchParams(location.search), id=query.get('widget'), api=query.get('api')||'http://localhost:4100';
if(id){
  let origin;
  try{const u=new URL(api);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw new Error();origin=u.origin;}
  catch{document.querySelector('#embed').textContent='Use an HTTPS API URL, or localhost for local development.';}
  if(origin){const script=document.createElement('script');script.src=`${origin}/widget.v1.js?id=${encodeURIComponent(id)}`;script.async=true;document.querySelector('#embed').append(script);}
}else{
  document.querySelector('#setup').hidden=false;
  document.querySelector('#connect').onsubmit=e=>{e.preventDefault();location.search=new URLSearchParams({widget:e.target.widget.value,api}).toString();};
}
