const samples=[['沪深300','510300','4.126','+0.82%'],['中证500','510500','6.342','-0.18%'],['科创50','588000','1.086','+1.24%']]
document.querySelector('#list').innerHTML=samples.map(([name,code,price,change])=>`<article><div><b>${name}</b><small>${code}</small></div><strong>${price}</strong><span class="${change.startsWith('+')?'up':'down'}">${change}</span></article>`).join('')
