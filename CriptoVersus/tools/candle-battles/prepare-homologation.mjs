#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildCaption, countLeadChanges, parseTrendingTopics } from './publication-utils.mjs';
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,x)=>{if(v.startsWith('--'))a.push([v.slice(2),x[i+1]]);return a;},[]));
if(!args.battle||!args.trends||!args.output)throw new Error('Usage: --battle battle.json --trends trends.json --output post.txt');
const battle=JSON.parse(await readFile(resolve(args.battle),'utf8'));const trends=JSON.parse(await readFile(resolve(args.trends),'utf8'));
if(battle.status!=='Completed'||battle.battleStatus!=='finished'||battle.replayAvailable!==true||battle.canPost!==true)throw new Error(`Battle is not eligible: ${battle.skipReason??battle.replayUnavailableReason??battle.status}`);
if(!Array.isArray(battle.rounds)||battle.rounds.length!==battle.confrontationCount||battle.rounds.some(r=>!r.left?.confirmed||!r.right?.confirmed))throw new Error('Battle history is incomplete or unconfirmed');
const topics=parseTrendingTopics(trends);const selected=topics.find(x=>x.tag.toLowerCase()!=='#criptoversus');if(!selected)throw new Error('No verified TopHashtag');
const caption=buildCaption(battle,selected.tag);await writeFile(resolve(args.output),caption+'\n',{flag:'wx'});
console.log(JSON.stringify({matchId:battle.matchId,leftSymbol:battle.assetA.symbol,rightSymbol:battle.assetB.symbol,scoreA:battle.scoreA,scoreB:battle.scoreB,rounds:battle.rounds.length,leadChanges:countLeadChanges(battle.rounds),topHashtag:selected.tag,hashtagRank:selected.rank,output:resolve(args.output)},null,2));
