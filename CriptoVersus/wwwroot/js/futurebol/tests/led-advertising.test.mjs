import assert from 'node:assert/strict';
import B from 'babylonjs';
import { readFileSync } from 'node:fs';
import { FuturebolLedAdvertising, advertisingQuality, advertisingMessage, advertisingPrice, advertisingPercentage, fitAdvertisingText } from '../../dist/futurebol/futurebol-led-advertising.js';
const teams = {home:{symbol:'BTC',logoUrl:null},away:{symbol:'ETH',logoUrl:null}};
const input = {home:{price:56234.2,changePercent:23.59},away:{price:0.0046,changePercent:-3.62},locale:'pt'};
assert.equal(advertisingMessage(input,teams,0).text,'BTC  $56,234.20');
assert.equal(advertisingMessage(input,teams,2).text,'ETH  $0.0046');
for (const [value,expected] of [[2.41,'$2.41'],[0.0046,'$0.0046'],[NaN,'—'],[undefined,'—'],[Infinity,'—']]) assert.equal(advertisingPrice(value),expected);
assert.equal(advertisingPercentage(23.59).text,'▲ +23.59%');
assert.equal(advertisingPercentage(-3.62).text,'▼ -3.62%');
assert.equal(advertisingPercentage(-0.0001).text,'0.00%');
assert.equal(advertisingPercentage(NaN).text,'—');
assert.notEqual(advertisingPercentage(1).color,advertisingPercentage(-1).color);
assert.equal(fitAdvertisingText('Short',10,s=>s.length),'Short');
assert.equal(fitAdvertisingText('A very long message',8,s=>s.length),'A very …');
assert.notEqual(advertisingMessage(input,teams,3).text,advertisingMessage(input,teams,7).text);
assert.deepEqual(advertisingMessage(input,teams,7),advertisingMessage(input,teams,7));
assert.equal(advertisingMessage({...input,headlines:['Confirmed headline']},teams,9).type,'news');
assert.equal(advertisingMessage({...input,matchMessage:'Finished'},teams,5).type,'match');
assert.equal(advertisingMessage({home:null,away:null},teams,0).text,'BTC  —');
for (let start=0;start<120;start++) {
 const seen=new Set();
 for(let t=start;t<=start+15;t++) for(let i=0;i<3;i++) seen.add(advertisingMessage(input,teams,Math.floor((t+i*5.7)/5)).team);
 assert.ok(seen.has('home') && seen.has('away'));
}
let draws=0;
class Texture {
 constructor(){this.disposed=false;this.ctx={canvas:{},fillRect(){},strokeRect(){},fillText(){},drawImage(){draws++},measureText:s=>({width:s.length*12})};}
 getContext(){return this.ctx} update(){} dispose(){this.disposed=true}
}
const api={...B,DynamicTexture:Texture};
const engine=new B.NullEngine();const scene=new B.Scene(engine);
const homeLogo=new B.StandardMaterial('futurebol-home-logo-material',scene);homeLogo.diffuseTexture=new Texture();
for(const quality of ['Low','Medium','High']) {
 const baseline=scene.meshes.length;
 const led=new FuturebolLedAdvertising(api,scene,teams,quality);
 assert.equal(led.diagnostics().boards,advertisingQuality(quality).count);
 assert.ok(scene.meshes.filter(m=>m.name.startsWith('futurebol-led-')&&!m.parent).every(m=>m.position.z < -15 && m.position.y === 10.08 && m.rotation.x>0));
 const saved=JSON.stringify(input);led.update(.4,input);assert.equal(JSON.stringify(input),saved);
 const extra={symbol:'SOL',price:145.2,changePercent:4.88,momentum:50,volumeStrength:50};
 led.observeMarket({home:extra,away:{...extra,symbol:'DOGE'}},1000);
 assert.equal(led.extraMarkets(2000).length,2);
 assert.equal(advertisingMessage({...input,extraMarkets:led.extraMarkets(2000)},teams,3).text,'SOL  $145.20');
 assert.equal(advertisingMessage({...input,extraMarkets:led.extraMarkets(2000)},teams,0).team,'home');
 assert.equal(advertisingMessage({...input,extraMarkets:led.extraMarkets(2000)},teams,2).team,'away');
 assert.equal(led.extraMarkets(302000).length,0,'old observed prices expire');
 const updates=led.diagnostics().textureUpdates;
 for(let frame=0;frame<60;frame++) led.update(1/60,input);
 assert.equal(led.diagnostics().textureUpdates,updates,'no per-frame texture upload');
 led.update(5,input);assert.ok(led.diagnostics().textureUpdates>updates);
 led.setQuality('Low');assert.equal(led.diagnostics().boards,3);
 led.reset();led.update(0,{home:null,away:null});
 assert.ok(!JSON.stringify(led.diagnostics()).includes('NaN'));
 led.dispose();led.dispose();assert.equal(scene.meshes.length,baseline);
 assert.equal(homeLogo.diffuseTexture.disposed,false,'borrowed logo is not disposed');
 led.update(10,input);assert.equal(led.diagnostics().boards,0);
}
assert.ok(draws>0,'existing logo canvas reused');
const source=readFileSync(new URL('../futurebol-led-advertising.ts',import.meta.url),'utf8');
assert.ok(!source.includes('Math.random('));assert.ok(!source.includes('fetch('));assert.ok(!source.includes('setInterval('));
homeLogo.diffuseTexture=null;scene.dispose();engine.dispose();
console.log('LED advertising tests passed');
