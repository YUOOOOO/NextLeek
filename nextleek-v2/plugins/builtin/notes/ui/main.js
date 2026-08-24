const note = document.querySelector('#note')
const status = document.querySelector('#status')
async function load(){ const saved = await window.nextleek.call('storage.get',{key:'note'}); note.value = saved ?? '' }
document.querySelector('#save').addEventListener('click', async () => { await window.nextleek.call('storage.set',{key:'note',value:note.value}); status.textContent='已保存'; setTimeout(()=>status.textContent='',1200) })
load().catch(error => status.textContent=error.message)
