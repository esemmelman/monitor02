export function completedPeriods(s){const p=Number(s?.period||0);if(s?.type?.completed)return p;const end=/end of|halftime/i.test(s?.type?.detail||'')||s?.displayClock==='0:00';return Math.max(0,end?p:p-1)}
export function leaders(teams){return teams.map(t=>{
 const stats=t.statistics?.[0];if(!stats)return `${t.team?.displayName}: player stats unavailable`;
 const labels=stats.names||stats.labels||[];
 return `${t.team.displayName}\n`+[['points','PTS'],['rebounds','REB'],['assists','AST']].map(([key,label])=>{
 const i=labels.findIndex(x=>x.toLowerCase()===key||x.toUpperCase()===label);
 const rows=(stats.athletes||[]).filter(x=>!x.didNotPlay&&i>=0&&Number.isFinite(Number(x.stats?.[i])));
 if(!rows.length)return `${label}: unavailable`;
 const max=Math.max(...rows.map(x=>Number(x.stats[i])));return `${label}: ${rows.filter(x=>Number(x.stats[i])===max).map(x=>x.athlete.displayName).join(', ')} (${max})`;
 }).join('\n');})}
