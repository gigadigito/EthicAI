const symbolPattern = /^[A-Z0-9]{2,30}(?:USDT)?$/;
export function baseSymbol(value){const s=String(value??'').toUpperCase();if(!symbolPattern.test(s))throw new Error('invalid_symbol');return s.replace(/USDT$/,'');}
export function parseTrendingTopics(payload){
 const doc=payload?.data??payload?.body?.data??payload?.body??payload??{};const md=String(doc.markdown??'');const meta=doc.metadata??{};
 const official='https://www.binance.com/en/square/trends';if(![meta.sourceURL,meta.url].some(x=>x===official)||Number(meta.statusCode)!==200)return [];
 const begin=md.indexOf('# Trending Topics on Binance Square');if(begin<0)return [];const tail=md.slice(begin);const stop=tail.search(/Join global crypto users|# Most Searched \(6H\)/i);const section=stop<0?tail:tail.slice(0,stop);
 const out=[];for(const m of section.matchAll(/\[([\s\S]*?)\]\(https:\/\/www\.binance\.com\/en\/square\/hashtag\/([^)\s/?#]+)\)/gi)){
  let label=m[1].replace(/\\+/g,' ').replace(/\s+/g,' ').trim();let slug;try{slug=decodeURIComponent(m[2]);label=decodeURIComponent(label);}catch{continue;}const rank=Number(label.match(/^(10|[1-9])(?=\s)/)?.[1]);const count=label.match(/(\d[\d,.]*)\s+Discussing\b/i);
  if(!rank||!count||!slug||slug.length>150||/[\s<>\x00-\x1f#]/.test(slug)||!label.includes(`#${slug}`))continue;
  out.push({rank,tag:`#${slug}`,discussing:Number(count[1].replace(/[,\.]/g,''))});
 }
 return out.filter((x,i,a)=>a.findIndex(y=>y.rank===x.rank||y.tag.toLowerCase()===x.tag.toLowerCase())===i).sort((a,b)=>a.rank-b.rank);
}
export function countLeadChanges(rounds){let a=0,b=0,lead=0,changes=0;for(const r of rounds){if(r.winner==='left')a++;if(r.winner==='right')b++;const next=Math.sign(a-b);if(lead&&next&&next!==lead)changes++;if(next)lead=next;}return changes;}
export function buildCaption(battle,topHashtag){
 const left=baseSymbol(battle.assetA?.symbol),right=baseSymbol(battle.assetB?.symbol);if(left===right)throw new Error('same_symbol');
 if(!/^#[^\s#<>]{1,150}$/.test(topHashtag)||topHashtag.toLowerCase()==='#criptoversus')throw new Error('invalid_top_hashtag');
 const a=Number(battle.scoreA),b=Number(battle.scoreB),rounds=Array.isArray(battle.rounds)?battle.rounds:[];if(!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0)throw new Error('invalid_score');
 const goals=a+b===0?'A disputa terminou sem gols.':a===b?`Empate em ${a} a ${b}, com ${a+b} gols válidos.`:`Placar final ${a} a ${b}, com ${a+b} gols válidos.`;
 const changes=countLeadChanges(rounds);const turns=changes===0?'Sem mudança de liderança.':changes===1?'Uma mudança de liderança.':`${changes} mudanças de liderança.`;
 const text=`⚔️ Candle Battle: $${left} vs $${right}\n\n🔥 ${goals} ${turns}\n🎬 Relembre a evolução real dos candles até o resultado final.\n\n${topHashtag} #CriptoVersus\nDados históricos do mercado. Não é recomendação financeira.`;
 if((text.match(new RegExp(`\\$${left}\\b`,'g'))??[]).length!==1||(text.match(new RegExp(`\\$${right}\\b`,'g'))??[]).length!==1)throw new Error('cashtag_count');return text;
}
export function parseBinanceReceipt(payload){
 const candidates=[payload?.app_share_cvid,payload?.url,payload?.data?.app_share_cvid,payload?.data?.url].filter(x=>x!==undefined&&x!==null).map(String);
 for(const value of candidates){
  const direct=value.match(/^([0-9]+)$/);const app=value.match(/^https:\/\/app\.binance\.com\/uni-qr\/cvid\/([0-9]+)(?:\?.*)?$/i);const square=value.match(/^https:\/\/(?:www\.)?binance\.com\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?square\/post\/([0-9]+)\/?$/i);
  const id=direct?.[1]??app?.[1]??square?.[1];if(id)return {postId:id,postUrl:`https://www.binance.com/pt-BR/square/post/${id}`,source:value};
 }
 return null;
}
