/* js/46_topup.js — Credit Top-Up Modal */
(function(){
'use strict';
var _amt=0,_custom=0;
var FAST=100,DEEP=50;

window.openTopUpModal=function(){
  document.getElementById('topUpModal').style.display='flex';
  _amt=0;_custom=0;
  document.querySelectorAll('.topup-amt-btn').forEach(function(b){b.classList.remove('selected');});
  document.getElementById('topupCustomWrap').style.display='none';
  document.getElementById('topupCustomInput').value='';
  _preview(0);_enable(false);
  document.getElementById('topupError').style.display='none';
};

window.closeTopUpModal=function(){
  document.getElementById('topUpModal').style.display='none';
};

document.addEventListener('DOMContentLoaded',function(){
  var m=document.getElementById('topUpModal');
  if(m) m.addEventListener('click',function(e){if(e.target===m)window.closeTopUpModal();});
});

window.selectTopUpAmount=function(val){
  document.querySelectorAll('.topup-amt-btn').forEach(function(b){b.classList.remove('selected');});
  var btn=document.querySelector('.topup-amt-btn[data-amt="'+val+'"]');
  if(btn) btn.classList.add('selected');
  if(val==='custom'){
    _amt=0;
    document.getElementById('topupCustomWrap').style.display='block';
    document.getElementById('topupCustomInput').focus();
    _preview(_custom);_enable(_custom>=1);
  } else {
    document.getElementById('topupCustomWrap').style.display='none';
    _amt=parseInt(val,10);_custom=0;
    _preview(_amt);_enable(_amt>=1);
  }
};

window.onTopUpCustomInput=function(raw){
  var v=Math.max(1,Math.round(parseFloat(raw)||0));
  _custom=isNaN(v)?0:v;
  _preview(_custom);_enable(_custom>=1);
};

function _preview(d){
  var el=document.getElementById('topupPreviewText');
  if(!d||d<1){el.textContent='Miqdorni tanlang';return;}
  el.textContent='$'+d+' uchun: '+(d*FAST)+' ta Tez AI varoq yoki '+(d*DEEP)+' ta Chuqur AI varoq';
}

function _enable(ok){
  var btn=document.getElementById('topupPayBtn');
  btn.disabled=!ok;
  btn.style.opacity=ok?'1':'0.5';
  btn.style.cursor=ok?'pointer':'not-allowed';
}

window.startTopUpCheckout=async function(){
  var isCustom=document.querySelector('.topup-amt-btn[data-amt="custom"]');
  isCustom=isCustom&&isCustom.classList.contains('selected');
  var dollars=isCustom?_custom:_amt;
  if(!dollars||dollars<1) return;
  var cents=dollars*100;
  var errEl=document.getElementById('topupError');
  errEl.style.display='none';
  var token=(typeof getAuthToken==='function'?getAuthToken():null)
    ||(window._supabaseSession&&window._supabaseSession.access_token)
    ||(window.supabaseSession&&window.supabaseSession.access_token)||'';
  if(!token){
    errEl.textContent="To'lov uchun avval tizimga kiring.";
    errEl.style.display='block';return;
  }
  var btn=document.getElementById('topupPayBtn');
  var orig=btn.textContent;
  btn.textContent='Yuklanmoqda\u2026';btn.disabled=true;btn.style.cursor='wait';
  try{
    var r=await fetch('/api/payment/create-checkout',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({token:token,amount_cents:cents,return_url:window.location.origin})
    });
    var data=await r.json();
    if(!r.ok||!data.checkout_url) throw new Error(data.error||'Checkout URL olinmadi');
    window.closeTopUpModal();
    if(window.LemonSqueezy&&window.LemonSqueezy.Url&&typeof window.LemonSqueezy.Url.Open==='function'){
      window.LemonSqueezy.Url.Open(data.checkout_url);
    } else {
      window.open(data.checkout_url,'_blank');
    }
  }catch(err){
    errEl.textContent=err.message||"Xatolik. Qaytadan urinib ko'ring.";
    errEl.style.display='block';
  }finally{
    btn.textContent=orig;btn.disabled=false;
    _enable(true);
  }
};
})();
