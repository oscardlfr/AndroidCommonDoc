'use strict';

function createSessionRunTestBackend({
  isTestCapability,
  resolvedNodePath,
  resolveAppServerSpawnCommand,
  createCredentialSourceProvider,
  observeOwnedChildBornProvenance,
  realpathOrSelf,
}) {
  // Private W07b peer: a deterministic implementation of the exact JSONL
  // methods the existing supervisor startup path already drives.  It is source
  // for the one app-server child owned by that supervisor, not a second
  // process/scheduler.  No production argv can select it; the resolver below
  // requires isTestCapability() and the single closed backend literal.
  const DETERMINISTIC_APP_SERVER_SOURCE = [
    "'use strict';",
    "const readline=require('node:readline');",
    "let threadOrdinal=0;let turnOrdinal=0;const threads=new Map();",
    "const send=(value)=>process.stdout.write(JSON.stringify(value)+'\\n');",
    "const resultKind=(value)=>{if(!value||typeof value!=='object')return null;if(value.properties&&value.properties.result_kind&&Array.isArray(value.properties.result_kind.enum)&&typeof value.properties.result_kind.enum[0]==" +
      "='string')return value.properties.result_kind.enum[0];for(const child of Object.values(value)){const found=resultKind(child);if(found)return found;}return null;};",
    "readline.createInterface({input:process.stdin}).on('line',(line)=>{let frame;try{frame=JSON.parse(line);}catch{process.exit(2);}",
    "if(frame.method==='initialized'&&!Object.prototype.hasOwnProperty.call(frame,'id'))return;",
    "if(frame.method==='initialize'){send({id:frame.id,result:{codexHome:'deterministic',platformFamily:process.platform==='win32'?'windows':'unix',platformOs:process.platform,userAgent:'deterministic-app-server-v1'}});return;}",
    "if(frame.method==='account/login/start'){send({id:frame.id,result:{type:'chatgptAuthTokens'}});send({method:'account/updated',params:{authMode:'chatgptAuthTokens',planType:null}});return;}",
    "if(frame.method==='thread/start'){threadOrdinal+=1;const id='deterministic-thread-'+threadOrdinal;const now=Math.floor(Date.now()/1000);const cwd=frame.params.cwd;const thread={id,sessionId:'deterministic-session-'+threa" +
      "dOrdinal,forkedFromId:null,parentThreadId:null,preview:'',ephemeral:false,modelProvider:'openai',createdAt:now,updatedAt:now,recencyAt:null,status:{type:'idle'},path:null,cwd,cliVersion:'deterministic-app-server-v1',sour" +
      "ce:'cli',threadSource:null,agentNickname:null,agentRole:null,gitInfo:null,name:null,turns:[]};threads.set(id,thread);send({id:frame.id,result:{thread,approvalPolicy:'never',approvalsReviewer:'user',cwd,instructionSources" +
      ":[],model:'deterministic',modelProvider:'openai',sandbox:{type:'readOnly',networkAccess:false},serviceTier:null,reasoningEffort:null}});return;}",
    "if(frame.method==='turn/start'){turnOrdinal+=1;const id='deterministic-turn-'+turnOrdinal;send({id:frame.id,result:{turn:{id,status:'inProgress',items:[],itemsView:'full'}}});const kind=resultKind(frame.params&&frame.par" +
      "ams.outputSchema)||'role-bootstrap';const content=kind==='role-bootstrap'?'READY':'deterministic-answer:'+kind;const envelope={schema:'coordination/runtime-turn-envelope/v1',kind:'terminal-result',result:{schema:'coordin" +
      "ation/result-envelope/v1',status:'ANSWERED',result_kind:kind,content}};const completed={id,status:'completed',itemsView:'full',items:[{type:'agentMessage',id:'deterministic-message-'+turnOrdinal,phase:'final_answer',text" +
      ":JSON.stringify({envelope}),memoryCitation:null}]};const thread=threads.get(frame.params.threadId);if(thread)thread.turns.push(completed);setImmediate(()=>send({method:'turn/completed',params:{threadId:frame.params.threa" +
      "dId,turn:completed}}));return;}",
    "if(frame.method==='thread/read'){const thread=threads.get(frame.params.threadId);if(!thread){send({id:frame.id,error:{code:-32000,message:'thread not found'}});return;}send({id:frame.id,result:{thread:{...thread,turns:frame.params.includeTurns?thread.turns:[]}}});return;}",
    "if(frame.method==='thread/archive'){send({id:frame.id,result:{}});return;}",
    "send({id:frame.id,error:{code:-32601,message:'method not found'}});",
    "});",
  ].join('\n');

  /**
   * Resolves the app-server command for one already-authorized session-run.
   * The deterministic peer is selectable only through the private double
   * gate; all normal runs retain the production resolver unchanged.
   * @param {string|null} testBackend
   * @returns {{command:string,args:string[]}|{ok:false,reason:string}}
   */
  function resolveSessionRunSpawnCommand(testBackend) {
    if (testBackend === null || testBackend === undefined) return resolveAppServerSpawnCommand();
    if (!isTestCapability() || testBackend !== 'deterministic-app-server-v1') {
      return { ok: false, reason: 'test-backend-not-permitted' };
    }
    return { command: resolvedNodePath(), args: ['-e', DETERMINISTIC_APP_SERVER_SOURCE] };
  }

  /**
   * W07b's deterministic peer exercises transport, lifecycle, scheduler and
   * rendezvous mechanics without consulting the host's real Codex credential
   * store. Selection is already protected by cmdSessionRun's private double
   * gate; production and every non-deterministic run retain the real provider.
   */
  function resolveSessionRunCredentialSource(testBackend) {
    if (testBackend !== 'deterministic-app-server-v1') {
      return createCredentialSourceProvider().read();
    }
    if (!isTestCapability()) return { ok: false, reason: 'test-backend-not-permitted' };
    return {
      ok: true,
      credentials: {
        accessToken: 'w07b-deterministic-access-token',
        chatgptAccountId: 'w07b-deterministic-account',
        chatgptPlanType: null,
      },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      sourceIdentity: 'test-only:deterministic-app-server-v1',
    };
  }

  async function resolveSessionRunBornProvenance(testBackend, child, expectedExecutableIdentity, deadlineMs, observerJobs) {
    if (testBackend !== 'deterministic-app-server-v1') {
      return observeOwnedChildBornProvenance(child.pid, expectedExecutableIdentity, deadlineMs, observerJobs);
    }
    if (!isTestCapability() || !child || !Number.isInteger(child.pid) || child.pid <= 0) return { ok: false };
    try { process.kill(child.pid, 0); }
    catch (err) { if (err && err.code === 'ESRCH') return { ok: false }; }
    return {
      ok: true,
      birthToken: 'w07b-deterministic-child-birth-' + child.pid,
      pgid: child.pid,
      executableIdentity: realpathOrSelf(expectedExecutableIdentity),
    };
  }

  return Object.freeze({ resolveSessionRunSpawnCommand, resolveSessionRunCredentialSource, resolveSessionRunBornProvenance });
}

module.exports = Object.freeze({ createSessionRunTestBackend });
