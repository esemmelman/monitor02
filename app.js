/* Uses DayFlow's existing Supabase Auth and server-side Resend configuration. */
const SUPABASE_URL='https://fgomaujsdblpzxhnnqrg.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_JOUqLZDnfGu_yCa6k6FVDQ_AYwpr72i';
const el=id=>document.getElementById(id);
const client=window.supabase?.createClient(SUPABASE_URL,PUBLISHABLE_KEY);
let session=null,busy=false,running=false,timer=null;
el('gameDate').disabled=true;
function message(text){el('notice').textContent=text;}
function drawMode(){el('status').textContent=session?(running?'Background monitoring on':'Background monitoring paused'):'Sign in to view status';el('status').classList.toggle('running',Boolean(session&&running));el('toggle').textContent=running?'Pause background monitoring':'Enable background monitoring';el('mode').textContent=running?'Automatic checks every minute. Lakers monitoring advances to the next game after each final, even with this page closed.':'Background monitoring is paused. An email already being sent may finish.';}
function render(state){
 if(!state)return;
 el('temp').replaceChildren(document.createTextNode(state.weather?String(Math.trunc(state.weather.temp)):'—'));const unit=document.createElement('span');unit.textContent=' °F';el('temp').append(unit);
 el('weatherTime').textContent=state.weather?`Huntington Beach · checked ${new Date(state.weather.checked).toLocaleTimeString()}`:'Waiting for your first reading';
 el('gameName').textContent=state.game?.name||'Lakers game';el('gameScore').textContent=state.game?.score||'—';el('gameStatus').textContent=state.nextGameStatus||state.game?.status||'Waiting for a game check';el('leaders').textContent=state.game?.leaders?.join('\n\n')||'Points · Rebounds · Assists';
 const history=state.history||[];el('readingCount').textContent=`${history.length} readings`;el('history').replaceChildren(...history.slice().reverse().map(x=>{const tr=document.createElement('tr');for(const value of [x.sourceTime.replace('T',' '),`${Math.trunc(x.temp)}°F`]){const td=document.createElement('td');td.textContent=value;tr.append(td)}return tr}));
 if(!history.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=2;td.textContent='No readings recorded yet.';tr.append(td);el('history').append(tr)}
 el('queued').textContent=`${state.outbox?.length||0} queued`;el('activity').replaceChildren(...(state.sent||[]).slice(0,20).map(x=>{const div=document.createElement('div');div.className='delivery';div.textContent=x.subject.replace(/(-?\d+)\.\d+(?=°F)/g,'$1');const t=document.createElement('time');t.dateTime=x.time;t.textContent=new Date(x.time).toLocaleString();div.append(t);return div}));if(!state.sent?.length)el('activity').textContent='No emails sent yet.';
 el('lastCheck').textContent=state.lastCheck?'Last check: '+new Date(state.lastCheck).toLocaleString():'No checks yet';el('health').textContent=Object.entries(state.errors||{}).map(([key,value])=>`${key}: ${value}`).join('\n');
}
async function invoke(action,settings={}){
 const {data,error}=await client.auth.getSession();if(error)throw error;session=data.session;if(!session)throw Error('Sign in with your DayFlow account first.');
 const response=await fetch(`${SUPABASE_URL}/functions/v1/monitor02`,{method:'POST',headers:{'Content-Type':'application/json',apikey:PUBLISHABLE_KEY,Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action,...settings}),signal:AbortSignal.timeout(90000)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to connect');el('emailService').textContent=result.emailConfigured===false?'Email service is not configured.':'Email connected through DayFlow. No local service needed.';if(result.schedule){running=result.schedule.enabled;el('gameDate').value=result.schedule.gameDate;drawMode();}if(result.state)render(result.state);return result;
}
async function check(){if(!session||busy)return;busy=true;try{await invoke('status');}catch(e){message(e.message);}finally{busy=false;}}
async function accountChanged(next){session=next;el('signin').hidden=Boolean(session);el('connected').hidden=!session;el('gameDate').disabled=!session;el('account').textContent=session?'Connected as '+session.user.email:'';drawMode();clearInterval(timer);if(session){await check();timer=setInterval(check,15000);}}
el('signin').onsubmit=async event=>{event.preventDefault();el('login').disabled=true;message('Signing in…');try{const {data,error}=await client.auth.signInWithPassword({email:el('email').value.trim(),password:el('password').value});if(error)throw error;el('password').value='';message('Signed in. Background monitoring continues independently of this page.');await accountChanged(data.session);}catch(e){message(e.message)}finally{el('login').disabled=false}};
async function configure(enabled,gameDate){if(busy){message('Refreshing status. Try again shortly.');return}busy=true;el('toggle').disabled=true;try{await invoke('configure',{enabled,gameDate});message(running?'Background monitoring enabled.':'Background monitoring paused.');}catch(e){message(e.message)}finally{busy=false;el('toggle').disabled=false;}}
el('toggle').onclick=()=>configure(!running,el('gameDate').value);
el('test').onclick=async()=>{if(busy){message('A check is in progress. Try again shortly.');return}busy=true;el('test').disabled=true;try{const result=await invoke('test');if(result.busy)message('Another tab is checking. Try again shortly.');else if(result.state?.errors?.email)message(result.state.errors.email);else message('Test requested. Check Email activity for provider acceptance and your inbox for delivery.')}catch(e){message(e.message)}finally{busy=false;el('test').disabled=false}};
el('logout').onclick=async()=>{await client.auth.signOut({scope:'local'});await accountChanged(null);message('Signed out. Background monitoring keeps its saved setting.');};
el('gameDate').onchange=()=>configure(running,el('gameDate').value);
window.addEventListener('pagehide',()=>{clearInterval(timer)});window.addEventListener('pageshow',event=>{if(event.persisted){clearInterval(timer);timer=setInterval(check,15000);check()}});document.addEventListener('visibilitychange',()=>{if(!document.hidden)check()});
if(client){client.auth.onAuthStateChange((event,next)=>{if(event==='SIGNED_OUT')void accountChanged(null);else if(event==='TOKEN_REFRESHED')session=next;});client.auth.getSession().then(({data,error})=>{if(error)message(error.message);void accountChanged(data.session)});}else message('Unable to load the sign-in library. Refresh the page.');
