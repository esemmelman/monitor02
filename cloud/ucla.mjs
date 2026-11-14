// One-game subscription requested for November 13, 2026 (Pacific).
export const UCLA_EVENT='401858526';
export async function checkUcla(state,now,getJson,queue) {
 if(state.ucla?.complete||now<new Date('2026-11-13T08:00:00Z')||now>new Date('2026-11-15T08:00:00Z'))return;
 try{
  const data=await getJson(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${UCLA_EVENT}`);
  const comp=data.header?.competitions?.[0];
  const teams=comp?.competitors;
  const ucla=teams?.find(t=>t.team?.abbreviation==='UCLA');
  const opponent=teams?.find(t=>t!==ucla);
  if(!ucla||!opponent||!comp.status)throw Error('UCLA game feed is incomplete');
  const scores=[ucla,opponent].map(t=>Number(t.score));
  if([ucla,opponent].some(t=>t.score==null||t.score==='')||scores.some(s=>!Number.isInteger(s)||s<0))throw Error('UCLA score is unavailable');
  const score=`UCLA Bruins ${scores[0]} - ${opponent.team.displayName} ${scores[1]}`;
  const previous=state.ucla;
  const complete=Boolean(comp.status.type?.completed);
  const changed=previous&&previous.score!==score;
  const revision=(previous?.revision||0)+(changed?1:0);
  const status=comp.status.type?.detail||comp.status.type?.description||'';
  if(changed)queue(state,`ucla:${UCLA_EVENT}:change:${revision}`,score,`${score}\n\n${status}`,now);
  if(complete&&!changed&&previous)queue(state,`ucla:${UCLA_EVENT}:final`,`Final - ${score}`,`${score}\n\nFinal`,now);
  state.ucla={id:UCLA_EVENT,score,status,revision,complete,checked:now.toISOString()};
  delete state.errors.ucla;
 }catch(e){state.errors.ucla=e.message;}
}
