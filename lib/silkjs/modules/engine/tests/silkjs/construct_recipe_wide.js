// Constructor bodies that only store into `this` run from a recipe, without a frame:
// chained stores, bodies with up to 32 stores, and everything that must still decline.
const r = [];
function Chain(a, b) { this.x = a; this.p = this.q = this.r = null; this.n = this.m = 0; this.y = b; }
function Wide(a, b, c, d) {
  this.tag = a; this.key = c;
  this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null;
  this.index = 0; this.refCleanup = this.ref = null; this.pendingProps = b;
  this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null;
  this.mode = d; this.subtreeFlags = this.flags = 0; this.deletions = null;
  this.childLanes = this.lanes = 0; this.alternate = null;
}
function show(o) { return Object.keys(o).map((k) => k + '=' + String(o[k])).join(','); }
let last;
for (let i = 0; i < 50; i++) last = new Chain(i, 'b' + i);
r.push(show(last));
for (let i = 0; i < 50; i++) last = new Wide(i, { p: i }, 'k' + i, i & 1);
r.push(Object.keys(last).length, last.tag, last.key, last.pendingProps.p, last.mode, last.elementType, last.lanes, last.alternate);
r.push(Object.keys(last).join(',') === Object.keys(new Wide(1, 2, 3, 4)).join(','));
// Fewer arguments than parameters read undefined.
r.push(show(new Chain(1)));
// 32 stores are covered, 33 are not: both must build the same object.
function body(n) { let s = ''; for (let i = 0; i < n; i++) s += 'this.f' + i + ' = ' + (i % 3 === 0 ? 'a' : i % 3 === 1 ? 'null' : i) + ';'; return s; }
const F32 = new Function('a', body(32)), F33 = new Function('a', body(33));
for (let i = 0; i < 40; i++) { last = new F32(i); }
r.push(Object.keys(last).length, last.f0, last.f30, last.f31, last.f2);
for (let i = 0; i < 40; i++) { last = new F33(i); }
r.push(Object.keys(last).length, last.f0, last.f32, last.f31);
// A chained store of the same key twice keeps one property with the value.
function Twice(a) { this.k = this.k = a; this.z = 1; }
for (let i = 0; i < 40; i++) last = new Twice(i);
r.push(show(last));
// A chain that stores the receiver into itself is still a plain cycle.
function Self() { this.me = this.also = this; this.v = 1; }
for (let i = 0; i < 40; i++) last = new Self();
r.push(last.me === last, last.also === last, last.v);
// A setter on the prototype runs for a chained store, once objects were already planned.
function Watched(a) { this.a = this.w = a; this.b = 2; }
for (let i = 0; i < 40; i++) last = new Watched(i);
r.push(show(last));
let seen = [];
Object.defineProperty(Watched.prototype, 'w', { set(v) { seen.push(v); }, get() { return 'getter'; }, configurable: true });
last = new Watched(7);
r.push(show(last), last.w, seen.join());
delete Watched.prototype.w;
last = new Watched(8);
r.push(show(last));
// A frozen prototype chain member and a non-writable inherited property.
function Guarded(a) { this.g = this.h = a; }
for (let i = 0; i < 40; i++) last = new Guarded(i);
Object.defineProperty(Guarded.prototype, 'h', { value: 'fixed', writable: false, configurable: true });
last = new Guarded(5);
r.push(show(last), last.h);
// Subclass through new.target keeps its own prototype.
class Sub extends Wide {}
for (let i = 0; i < 40; i++) last = Reflect.construct(Wide, [i, null, null, 0], Sub);
r.push(last instanceof Sub, Object.keys(last).length, last.tag);
// Many objects stay intact across a collection and later property adds.
const all = [];
for (let i = 0; i < 3000; i++) all.push(new Wide(i, null, 'k', 0));
all[10].extra = 'added'; all[11].extra2 = 1; delete all[12].tag;
let sum = 0;
for (const f of all) sum += (f.tag | 0) + f.index + (f.alternate === null ? 1 : 0);
r.push(sum, all[10].extra, Object.keys(all[10]).length, Object.keys(all[12]).length, all[2999].tag);
const got = r.join('|');
const expected = 'x=49,r=null,q=null,p=null,m=0,n=0,y=b49|23|49|k49|49|1||0||true|x=1,r=null,q=null,p=null,m=0,n=0,y=undefined|'
  + '32|39|39||2|33|39|32||k=39,z=1|true|true|1|w=39,a=39,b=2|a=7,b=2|getter|7|w=8,a=8,b=2|g=5|fixed|true|23|39|'
  + '4501488|added|24|22|2999';
console.log(got === expected ? 'PASS construct recipe wide' : 'FAIL ' + got);
if (got !== expected) throw new Error('constructor recipe regressions');
