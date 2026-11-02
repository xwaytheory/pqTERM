import React from 'react'
import { createRoot } from 'react-dom/client'
import Sidebar from './src/components/Sidebar'
import './src/styles.css'
window.calls=[]
window.failFolder=false
window.pq={board:{get:async()=>null,onChange:()=>()=>{}},workspaces:{openFolder:async(id)=>{window.calls.push(['open',id]);if(window.failFolder)throw Error('missing')},select:async(id)=>window.calls.push(['select',id])}}
const snap={sidebarOpen:true,activeWorkspaceId:'a',providers:[],workspaces:[{id:'a',title:'pqTERM',cwd:'C:\\Users\\me\\pqTERM-dev',layout:1,panes:[{id:'p',engine:'omp',title:'Odnajdowanie sesji pracujących na pqTERM'}]},{id:'b',title:'Acme',cwd:'C:\\Users\\me\\Desktop\\Acme',layout:1,panes:[]}]}
document.body.innerHTML='<div id="check" style="display:flex;height:100vh"></div>'
createRoot(document.getElementById('check')).render(<Sidebar snap={snap} activity={{}} onNew={()=>{}} focusPane={()=>{}}/>)
