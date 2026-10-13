#!/usr/bin/env node
// Generate DPHKH1 (Kontrolní hlášení) + DPHDP3 (přiznání k DPH) XML from a
// classified line-item JSON. Encodes the accountant-validated schema so the
// attribute names, KH<->DPH tie-out, and rounding are correct by construction.
// Verified to reproduce the accountant's 2026 Q2 filing byte-for-byte.
//
// Usage: node build_xml.js input.json <outputDir>
//   KH amounts in haléře (2 dp, trailing zeros stripped); DPH in whole crowns.
//
// input.json shape:
// {
//   "period": {"rok":2026,"ctvrt":2,"d_poddp":"18.07.2026"},
//   "payer":  {"dic","titul","jmeno","prijmeni","ulice","c_pop","naz_obce","psc",
//              "email","c_telef","c_ufo","c_pracufo","c_okec",
//              "sest_jmeno","sest_prijmeni","sest_telef"},
//   "a4": [{"dic_odb","c_evid_dd","dppd","zaklad","dan"}],           // issued invoices >10k
//   "a2": [{"c_evid_dd","dppd","zaklad","dan","dph_line":5|12,       // reverse charge
//           "k_stat":"NL"|null,"vatid":"858562947B01"|null}],        // EU only: k_stat+vatid
//   "b3": {"zaklad","dan"}                                           // domestic <10k, aggregate
// }
const fs = require('node:fs');

const D = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const outDir = process.argv[3] || '.';

const h = n => String(Math.round(n * 100) / 100);   // haléře
const k = n => String(Math.round(n));               // celé Kč
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const attr = o => Object.entries(o).filter(([,v]) => v !== null && v !== undefined && v !== '').map(([kk,v]) => `${kk}="${esc(v)}"`).join(' ');

const a4 = D.a4 || [], a2 = D.a2 || [], b3 = D.b3 || { zaklad: 0, dan: 0 }, p = D.payer, per = D.period;
const a4_zaklad = sum(a4, x => x.zaklad), a4_dan = sum(a4, x => x.dan);
const z5  = sum(a2.filter(x=>x.dph_line===5),  x=>x.zaklad), d5  = sum(a2.filter(x=>x.dph_line===5),  x=>x.dan);
const z12 = sum(a2.filter(x=>x.dph_line===12), x=>x.zaklad), d12 = sum(a2.filter(x=>x.dph_line===12), x=>x.dan);
const a2_zaklad = sum(a2, x => x.zaklad), a2_dan = sum(a2, x => x.dan);

// ---- KONTROLNÍ HLÁŠENÍ ----
let kh = `<?xml version="1.0" encoding="UTF-8"?>\n<Pisemnost nazevSW="vat-return skill" verzeSW="1.0">\n<DPHKH1 verzePis="03.01">\n`;
kh += `<VetaD ${attr({dokument:'KH1',k_uladis:'DPH',rok:per.rok,ctvrt:per.ctvrt,d_poddp:per.d_poddp,khdph_forma:'B'})} />\n`;
kh += `<VetaP ${attr({c_ufo:p.c_ufo,c_pracufo:p.c_pracufo,dic:p.dic,typ_ds:'F',titul:p.titul,jmeno:p.jmeno,prijmeni:p.prijmeni,ulice:p.ulice,c_pop:p.c_pop,naz_obce:p.naz_obce,psc:p.psc,email:p.email,sest_jmeno:p.sest_jmeno,sest_prijmeni:p.sest_prijmeni,sest_telef:p.sest_telef,c_telef:p.c_telef})} />\n`;
a2.forEach((x,i) => kh += `<VetaA2 ${attr({c_radku:i+1,k_stat:x.k_stat,vatid_dod:x.vatid,c_evid_dd:x.c_evid_dd,dppd:x.dppd,zakl_dane1:h(x.zaklad),dan1:h(x.dan)})} />\n`);
a4.forEach((x,i) => kh += `<VetaA4 ${attr({c_radku:i+1,dic_odb:x.dic_odb,c_evid_dd:x.c_evid_dd,dppd:x.dppd,zakl_dane1:h(x.zaklad),dan1:h(x.dan),kod_rezim_pl:0,zdph_44:'N'})} />\n`);
kh += `<VetaB3 ${attr({zakl_dane1:h(b3.zaklad),dan1:h(b3.dan)})} />\n`;
kh += `<VetaC ${attr({obrat23:h(a4_zaklad),obrat5:0,pln23:h(b3.zaklad),pln5:0,pln_rez_pren:0,rez_pren23:0,rez_pren5:0,celk_zd_a2:h(a2_zaklad)})} />\n`;
kh += `</DPHKH1>\n</Pisemnost>\n`;

// ---- PŘIZNÁNÍ K DPH ----
const dan23 = Math.round(a4_dan), dpsl_e = Math.round(d5), dpsl_z = Math.round(d12);
// ř.43 deduction = the rounded ř.5 + ř.12 tax, so reverse charge nets to exactly zero
const odp_tuz = Math.round(b3.dan), od_zdp = dpsl_e + dpsl_z;
const vystup = dan23 + dpsl_e + dpsl_z, odpocet = odp_tuz + od_zdp, vlastni = vystup - odpocet;

let dp = `<?xml version="1.0" encoding="UTF-8"?>\n<Pisemnost nazevSW="vat-return skill" verzeSW="1.0">\n<DPHDP3 verzePis="03.01">\n`;
dp += `<VetaD ${attr({c_okec:p.c_okec,ctvrt:per.ctvrt,d_poddp:per.d_poddp,dapdph_forma:'B',dokument:'DP3',k_uladis:'DPH',rok:per.rok,trans:'A',typ_platce:'P'})} />\n`;
dp += `<VetaP ${attr({c_pop:p.c_pop,c_telef:p.c_telef,c_ufo:p.c_ufo,c_pracufo:p.c_pracufo,dic:p.dic,email:p.email,jmeno:p.jmeno,naz_obce:p.naz_obce,prijmeni:p.prijmeni,psc:p.psc,sest_jmeno:p.sest_jmeno,sest_prijmeni:p.sest_prijmeni,sest_telef:p.sest_telef,titul:p.titul,typ_ds:'F',ulice:p.ulice})} />\n`;
dp += `<Veta1 ${attr({dan23:k(dan23),dan5:0,dan_dzb23:0,dan_dzb5:0,dan_pdop_nrg:0,dan_psl23_e:k(dpsl_e),dan_psl23_z:k(dpsl_z),dan_psl5_e:0,dan_psl5_z:0,dan_pzb23:0,dan_pzb5:0,dov_zb23:0,dov_zb5:0,obrat23:k(a4_zaklad),obrat5:0,p_dop_nrg:0,p_sl23_e:k(z5),p_sl23_z:k(z12),p_sl5_e:0,p_sl5_z:0,p_zb23:0,p_zb5:0})} />\n`;
dp += `<Veta2 dod_dop_nrg="0" dod_zb="0" pln_ost="0" pln_sluzby="0" pln_vyvoz="0" pln_zaslani="0" />\n`;
dp += `<Veta3 dov_osv="0" opr_dluz="0" opr_verit="0" tri_dozb="0" tri_pozb="0" />\n`;
dp += `<Veta4 ${attr({dov_cu:0,nar_maj:0,nar_zdp23:k(a2_zaklad),nar_zdp5:0,od_maj:0,od_zdp23:k(od_zdp),od_zdp5:0,odkr_maj:0,odkr_zdp23:0,odkr_zdp5:0,odp_cu:0,odp_cu_nar:0,odp_rez_nar:0,odp_rezim:0,odp_sum_kr:0,odp_sum_nar:k(odpocet),odp_tuz23:0,odp_tuz23_nar:k(odp_tuz),odp_tuz5:0,odp_tuz5_nar:0,pln23:k(b3.zaklad),pln5:0})} />\n`;
dp += `<Veta5 odp_uprav_kf="0" plnosv_kf="0" plnosv_nkf="0" />\n`;
dp += `<Veta6 ${attr({dan_vrac:0,dan_zocelk:k(vystup),dano_da:vlastni>=0?k(vlastni):0,dano_no:vlastni<0?k(-vlastni):0,odp_zocelk:k(odpocet)})} />\n`;
dp += `</DPHDP3>\n</Pisemnost>\n`;

const q = `${per.rok}Q${per.ctvrt}`;
fs.writeFileSync(`${outDir}/DPHKH1_${q}.xml`, kh);
fs.writeFileSync(`${outDir}/DPHDP3_${q}.xml`, dp);
console.log(`KH:  A.4 ${h(a4_zaklad)}/${h(a4_dan)} | A.2 ${h(a2_zaklad)}/${h(a2_dan)} | B.3 ${h(b3.zaklad)}/${h(b3.dan)}`);
console.log(`DPH: vystup ${k(vystup)} - odpocet ${k(odpocet)} = ${vlastni>=0?'vlastni dan':'nadmerny odpocet'} ${k(Math.abs(vlastni))} Kc`);
console.log(`Wrote DPHKH1_${q}.xml, DPHDP3_${q}.xml to ${outDir}`);
