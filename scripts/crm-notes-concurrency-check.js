'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('assets/staff-pages-v2.js','utf8');
const code=source.slice(source.indexOf('  function crmClientKey(row)'),source.indexOf('  function crmRelanceComposer(selected)'));
let checks=0,fail=false,pending,posts=[];
const row={id:'qa',phone:'0487 78 48 16'}, notes={key:'',body:'',loaded:false,loading:false,saving:false};
const ctx=vm.createContext({window:{PinlaneStaffNotes:{invalidate(){}}},state:{adminCenterId:'libramont'},crmNotes:notes,getStaffClientRows:()=>[row],renderStaffClientsPage(){},toast(){},
apiRequest:async(_,opt)=>{if(!opt)return{note:{body:'Stored',updatedAt:'v1',clientKey:'+32487784816'}};posts.push(JSON.parse(opt.body));if(fail)throw new Error('Network error');if(pending)return new Promise(resolve=>{pending.resolve=resolve;});return{note:{updatedAt:'v2'},clientKey:'+32487784816'};}});
vm.runInContext(code,ctx);
(async()=>{
 await ctx.loadCrmClientNote(row);assert.equal(notes.key,'libramont:0487784816');checks++;
 fail=true;await ctx.window.crmSaveClientNote('qa','Retained draft');assert.equal(notes.draft,'Retained draft');assert.equal(notes.body,'Stored');assert.ok(notes.error);checks++;
 fail=false;await ctx.window.crmSaveClientNote('qa','Retained draft');assert.equal(notes.body,'Retained draft');assert.equal(notes.error,'');checks++;
 pending={};const save=ctx.window.crmSaveClientNote('qa','First draft');ctx.window.crmClientNoteDraft('qa','Second draft');
 pending.resolve({note:{updatedAt:'v3'}});pending=null;await save;await new Promise(r=>setTimeout(r,0));assert.equal(posts.at(-1).body,'Second draft');assert.equal(notes.body,'Second draft');checks++;
 pending={};const oldSave=ctx.window.crmSaveClientNote('qa','Old center draft');ctx.state.adminCenterId='gembloux';await ctx.loadCrmClientNote(row);
 pending.resolve({note:{updatedAt:'old-version'}});pending=null;await oldSave;assert.equal(notes.key,'gembloux:0487784816');assert.equal(notes.body,'Stored');assert.equal(notes.updatedAt,'v1');checks++;
 console.log(`CRM notes concurrency: ${checks} passed.`);
})().catch(e=>{console.error(e);process.exit(1);});
