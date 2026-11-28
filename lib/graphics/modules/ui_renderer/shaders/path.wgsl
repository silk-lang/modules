// Paths: `vector` coverage strips (4-row bands with one coverage byte per row, packed into a
// word per column) and fully covered runs, placed at the path's integer origin. The band layout
// is gpu_scene's, except that bands start at the sprite's own y and every run has a paint record.
struct Run {
  x: i32,
  y: i32,
  width: u32,
  // Word index of the first column in `alphas`, or SOLID for a fully covered run.
  alpha: u32,
  path: u32,
  // The last row + 1 the path covers.
  bottom: i32,
  unused0: u32,
  unused1: u32,
}
struct PathRecord {
  mask: vec4f,
  paint: Paint,
  maskRadii: Radii,
}
@group(0) @binding(1) var<storage, read> runs: array<Run>;
@group(0) @binding(2) var<storage, read> paths: array<PathRecord>;
@group(0) @binding(3) var<storage, read> alphas: array<u32>;

const SOLID: u32 = 0xffffffffu;

struct Varying { @builtin(position) position: vec4f, @location(0) @interpolate(flat) index: u32 }

@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) index: u32) -> Varying {
  let r = runs[index];
  let path = paths[r.path];
  let g = placements[u32(path.paint.stops.w)];
  let dx = i32(g.offset.z);
  let dy = i32(g.offset.w);
  let rx = r.x + dx;
  let ry = r.y + dy;
  let rbottom = r.bottom + dy;
  let own = path.mask + g.offset.xyxy;
  let clipRect = vec4f(max(own.xy, g.clip.xy), min(own.zw, g.clip.zw));
  let top = f32(ry);
  let x = f32(rx);
  let bounds = vec4f(x, top, x + f32(r.width), f32(min(ry + 4, rbottom)));
  return Varying(corner(cover(bounds, clipRect), v), index);
}

@fragment fn fs(v: Varying) -> @location(0) vec4f {
  let r = runs[v.index];
  let path = paths[r.path];
  let g = placements[u32(path.paint.stops.w)];
  let p = v.position.xy + globals.origin.xy;
  let own = path.mask + g.offset.xyxy;
  let clipRect = vec4f(max(own.xy, g.clip.xy), min(own.zw, g.clip.zw));
  let clip = areaIn(clipRect, p) * cornerCoverage(own, path.maskRadii, p)
    * cornerCoverage(g.clip, g.clipRadii, p);
  if clip <= 0.0 { discard; }
  let rx = r.x + i32(g.offset.z);
  let ry = r.y + i32(g.offset.w);
  var alpha = 1.0;
  if r.alpha != SOLID {
    let column = u32(i32(floor(p.x)) - rx);
    let row = u32(i32(floor(p.y)) - ry);
    alpha = f32((alphas[r.alpha + column] >> (8u * row)) & 255u) / 255.0;
  }
  return shade(path.paint, p - g.offset.xy) * (alpha * clip);
}
