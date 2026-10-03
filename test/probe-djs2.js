const axios=require('axios');
const H={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36','Accept':'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','Accept-Language':'en-US,en;q=0.9','Referer':'https://duckduckgo.com/','sec-ch-ua':'"Chromium";v="124", "Google Chrome";v="124"','sec-ch-ua-mobile':'?0','sec-ch-ua-platform':'"Windows"','Sec-Fetch-Dest':'document','Sec-Fetch-Mode':'navigate','Sec-Fetch-Site':'same-site','Sec-Fetch-User':'?1','Upgrade-Insecure-Requests':'1'};
(async()=>{
 const home=await axios.get('https://duckduckgo.com/',{params:{q:'weather tokyo'},headers:H,timeout:15000,validateStatus:()=>true});
 const html=String(home.data);
 let vqd=null; for(const [a,b] of [['vqd="','"'],['vqd=','&'],["vqd='","'"]]){const i=html.indexOf(a); if(i>=0){vqd=html.substring(i+a.length,html.indexOf(b,i+a.length)); break;}}
 const ck=(home.headers['set-cookie']||[]).map(c=>c.split(';')[0]).join('; ');
 console.log('vqd='+(vqd?'yes':'no')+' cookie='+(ck?ck.slice(0,40):'none'));
 await new Promise(r=>setTimeout(r,1000));
 const r=await axios.get('https://links.duckduckgo.com/d.js',{params:{q:'weather tokyo',vqd,kl:'wt-wt',l:'us-en',s:'0',o:'json',v:'l',dc:'1',f:','},headers:{...H,Cookie:ck},timeout:15000,validateStatus:()=>true});
 const b=String(r.data);
 console.log('status='+r.status+' len='+b.length);
 console.log('head='+b.slice(0,200).replace(/\s+/g,' '));
 try{const j=JSON.parse(b); console.log('results='+(j.results||[]).length+' first='+JSON.stringify((j.results||[])[0]));}catch(e){console.log('notjson');}
 process.exit(0);
})();
