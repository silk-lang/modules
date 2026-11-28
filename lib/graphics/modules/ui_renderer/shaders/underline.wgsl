// Underlines: the top `thickness` rows of the bounds, or a sine wave of that stroke width with
// wavelength 8 * thickness, centered in the bounds.
struct Underline {
  bounds: vec4f,
  mask: vec4f,
  // straight alpha
  color: vec4f,
  // thickness, wavy (1 or 0), the transform, scroll group
  params: vec4f,
  maskRadii: Radii,
}
@group(0) @binding(1) var<storage, read> underlines: array<Underline>;

struct Varying { @builtin(position) position: vec4f, @location(0) @interpolate(flat) index: u32, @location(1) local: vec2f }

@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) index: u32) -> Varying {
  let u = underlines[index];
  let g = placements[u32(u.params.w)];
  let own = u.mask + g.offset.xyxy;
  let clipRect = vec4f(max(own.xy, g.clip.xy), min(own.zw, g.clip.zw));
  let placed = place(u.bounds + g.offset.xyxy, clipRect, u32(u.params.z), v);
  return Varying(placed.position, index, placed.local);
}

const TAU: f32 = 6.283185307179586;

@fragment fn fs(v: Varying) -> @location(0) vec4f {
  let u = underlines[v.index];
  let g = placements[u32(u.params.w)];
  let at = spot(v.position, v.local, u32(u.params.z));
  let p = at.p;
  let lp = p - g.offset.xy;
  let b = u.bounds;
  let own = u.mask + g.offset.xyxy;
  let clipRect = vec4f(max(own.xy, g.clip.xy), min(own.zw, g.clip.zw));
  let maskCov = cornerCoverageAt(own, u.maskRadii, p, at.scale) * cornerCoverageAt(g.clip, g.clipRadii, p, at.scale);
  let thickness = u.params.x;
  var alpha = 0.0;
  if u.params.y == 0.0 {
    alpha = areaInAt(vec4f(b.x, b.y, b.z, min(b.y + thickness, b.w)), lp, at.scale) * areaInAt(clipRect, p, at.scale) * maskCov;
  } else {
    // Distance to the wave, to first order: the vertical gap over the slope's length.
    let amplitude = max((b.w - b.y - thickness) * 0.5, 0.0);
    let k = TAU / (8.0 * thickness);
    let x = lp.x - b.x;
    let gap = lp.y - (b.y + b.w) * 0.5 - amplitude * sin(k * x);
    let slope = amplitude * k * cos(k * x);
    let distance = abs(gap) / sqrt(1.0 + slope * slope);
    let shiftedBounds = b + g.offset.xyxy;
    let clipped = vec4f(max(clipRect.xy, shiftedBounds.xy), min(clipRect.zw, shiftedBounds.zw));
    alpha = clamp((thickness * 0.5 - distance) * at.scale.y + 0.5, 0.0, 1.0) * areaInAt(clipped, p, at.scale) * maskCov;
  }
  alpha = alpha * at.keep;
  if alpha <= 0.0 { discard; }
  return premultiply(u.color) * alpha;
}
