function P(v,n){this.v=v;this.n=n}P.prototype.sum=function(){var t=0;var p=this;while(p!=null){t=t+p.v;p=p.n}return t};P.prototype.first=function(){return this.v};function twice(l){return l.sum()+l.first()}function build(k){var l=null;for(var i=0;i<k;i++)l=new P(i,l);return l}function run(l){var t=0;for(var i=0;i<300;i++)t=(t+twice(l))|0;return t}var L=build(20);
print(run(L));
function thrower(n){if(n>250)throw new Error('boom');return n}function mid(n){return thrower(n)+1}var c=0;try{for(var i=0;i<300;i++)c+=mid(i)}catch(e){c=c+1000000}
print(c);
function f(n){return n==0?0:1+f(n-1)}var r=0;for(var i=0;i<100;i++)r+=f(50);try{f(1e6);r=-1}catch(e){r=r+(e instanceof RangeError?1:0)}
print(r);
