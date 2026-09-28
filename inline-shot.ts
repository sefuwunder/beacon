import { readFileSync, writeFileSync } from "fs";

const stub = `
var __CANNED = {
  "/api/search": { jobs: [
    { id:"demo1", industry:"IT services", location:"Cincinnati, OH", status:"done", company_count:4, created_at: Date.now()-86400000 },
    { id:"demo2", industry:"coffee roasters", location:"Austin, TX", status:"running", company_count:0, created_at: Date.now()-3600000 }
  ]},
  "/api/search/demo1": { id:"demo1", industry:"dental clinics", location:"Madisonville, Cincinnati", status:"done",
    progress:{done:2,total:2,current:""}, error:null,
    companies:[
      {name:"GFFYN Network Solutions",description:"Managed IT services and network infrastructure for mid-market firms across the Midwest.",url:"https://gffyn-network-solutions.com",industry:"IT services",location:"Cincinnati, OH",source:"findall",sector:"Business Services",subsector:"IT Services",stage:"Unfunded",founded_year:"2014",country:"United States",state:"Ohio",city:"Cincinnati",acquisitions:""},
      {name:"Bright Smile Dental",description:"Family dental practice offering cosmetic dentistry, implants and Invisalign in Madisonville.",url:"https://brightsmiledental.example.com",industry:"dental clinics",location:"Madisonville, Cincinnati",source:"findall",sector:"Healthcare",subsector:"Dental Clinics",stage:"",founded_year:"2009",country:"United States",state:"Ohio",city:"Cincinnati",acquisitions:""},
      {name:"Queen City Dental Studio",description:"Modern studio focused on preventive care and same-day crowns.",url:"https://queencitydental.example.com",industry:"dental clinics",location:"Madisonville, Cincinnati",source:"findall"},
      {name:"Madisonville Orthodontics",description:"Orthodontic specialists - braces and clear aligners for teens and adults.",url:"",industry:"dental clinics",location:"Madisonville, Cincinnati",source:"findall"}
    ], warnings:[], nodes:[] }
};
window.fetch = function(url, opts) {
  var u = String(url).split("?")[0];
  if (u==="/api/search" && opts && opts.method==="POST") {
    return Promise.resolve({ ok:true, json: function(){ return Promise.resolve({job_id:"demo1",status:"running"}); } });
  }
  var hit = __CANNED[u];
  return Promise.resolve({ ok: !!hit, status: hit?200:404, json: function(){ return Promise.resolve(hit || {error:"not found"}); } });
};
`;

let html = readFileSync("public/index.html", "utf8");
const css = readFileSync("public/styles.css", "utf8");
let js = readFileSync("public/app.js", "utf8");
js = stub + js;
html = html.replace('<link rel="stylesheet" href="styles.css">', "<style>" + css.replace(/<\//g, "<\\/") + "</style>");
html = html.replace('<script src="app.js"></script>', "<script>" + js.replace(/<\//g, "<\\/") + "</script>");
const which = process.argv[2] || "home";
if (which === "results") {
  // postamble: drive straight into the results view (hash assignment is
  // unreliable on data: URLs in this Chromium build)
  html = html.replace('</body>', '<script>renderResults("demo1")</script></body>');
}
writeFileSync("/tmp/beacon-inline-" + which + ".html", html);
console.log("wrote", html.length, "bytes for", which);
