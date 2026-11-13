/* js/47_resize_fix.js — Smart table/chart resize (no pixel-stretch) */
(function(){
'use strict';
function _patchCanvas(c){
  if(!c||c.__resizePatchApplied) return;
  c.__resizePatchApplied=true;
  c.on('object:scaling',function(e){
    var o=e.target; if(!o) return;
    var t=o.slideType||o.customType||o.ssKind||(o.get&&o.get('slideType'));
    if(t==='table'||t==='chart'){
      var nw=Math.round((o.width||100)*o.scaleX);
      var nh=Math.round((o.height||100)*o.scaleY);
      o.set({width:nw,height:nh,scaleX:1,scaleY:1});
      if(t==='table'&&typeof reflowTable==='function') reflowTable(o);
      if(t==='chart'&&typeof reflowChart==='function') reflowChart(o);
      o.setCoords&&o.setCoords();
      c.renderAll&&c.renderAll();
    }
  });
  c.on('object:modified',function(e){
    var o=e.target; if(!o) return;
    var t=o.slideType||o.customType||o.ssKind||(o.get&&o.get('slideType'));
    if((t==='table'||t==='chart')&&(o.scaleX!==1||o.scaleY!==1)){
      var nw=Math.round((o.width||100)*o.scaleX);
      var nh=Math.round((o.height||100)*o.scaleY);
      o.set({width:nw,height:nh,scaleX:1,scaleY:1});
      if(t==='table'&&typeof reflowTable==='function') reflowTable(o);
      if(t==='chart'&&typeof reflowChart==='function') reflowChart(o);
      o.setCoords&&o.setCoords();
      c.renderAll&&c.renderAll();
    }
  });
}
// Patch whenever canvas is initialized
var _orig=window.fabric&&window.fabric.Canvas;
document.addEventListener('DOMContentLoaded',function(){
  setTimeout(function(){
    var c = window.canvas || (typeof canvas !== 'undefined' ? canvas : null);
    if(c) _patchCanvas(c);
  },500);
  setTimeout(function(){
    var c = window.canvas || (typeof canvas !== 'undefined' ? canvas : null);
    if(c) _patchCanvas(c);
  },1000);
});
// Also patch if canvas is set later
try {
  var _cv = window.canvas || (typeof canvas !== 'undefined' ? canvas : null);
  if (_cv) _patchCanvas(_cv);
  Object.defineProperty(window,'canvas',{
    get:function(){return window._canvas || (typeof canvas !== 'undefined' ? canvas : null);},
    set:function(v){window._canvas=v;if(v)_patchCanvas(v);},
    configurable:true
  });
} catch(e){}
})();
