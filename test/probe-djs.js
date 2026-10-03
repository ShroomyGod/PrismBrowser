const axios=require('axios');
(async()=>{
 const r=await axios.get('https://links.duckduckgo.com/d.js',{params:{q:'weather tokyo',kl:'wt-wt',l:'us-en',s:'0',o:'json',b:'',dc:'1'},headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36','Referer':'https://duckduckgo.com/'},timeout:15000,validateStatus:()=>true});
 console.log('status='+r.status); console.log('body='+String(r.data).slice(0,400));
 process.exit(0);
})();
