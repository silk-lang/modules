// Polychrome sprites: images, color glyphs and color icons from premultiplied RGBA tiles, with
// opacity, corner radii and grayscale.
struct PolySprite {
  bounds: vec4f,
  mask: vec4f,
  tile: vec4f,
  clipBounds: vec4f,
  radii: Radii,
  // opacity, flags (1 grayscale, 2 nearest), quarter turns, the transform
  params: vec4f,
  maskRadii: Radii,
  // x is the scroll group (a `Placement`).
  extra: vec4f,
}
@group(0) @binding(1) var<storage, read> sprites: array<PolySprite>;

fn cameraSprite(source: PolySprite) -> PolySprite {
  var s = source;
  let camera = globals.imageCamera;
  let translation = vec4f(camera.zw, camera.zw);
  s.bounds = source.bounds * camera.x + translation;
  s.mask = source.mask * camera.x + translation;
  s.clipBounds = source.clipBounds * camera.x + translation;
  s.radii = Radii(source.radii.x * camera.x, source.radii.y * camera.x);
  s.maskRadii = Radii(source.maskRadii.x * camera.x, source.maskRadii.y * camera.x);
  return s;
}

@vertex fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) index: u32) -> Varying {
  let raw = sprites[index];
  let g = placements[u32(raw.extra.x)];
  let s = cameraSprite(raw);
  let own = s.mask + g.offset.xyxy;
  let clipRect = vec4f(max(own.xy, g.clip.xy), min(own.zw, g.clip.zw));
  let placed = place(s.bounds + g.offset.xyxy, clipRect, u32(s.params.w), v);
  return Varying(placed.position, index, placed.local);
}

@fragment fn fs(v: Varying) -> @location(0) vec4f {
  let raw = sprites[v.index];
  let g = placements[u32(raw.extra.x)];
  let s = cameraSprite(raw);
  let at = spot(v.position, v.local, u32(s.params.w));
  let p = at.p;
  let lp = p - g.offset.xy;
  let own = s.mask + g.offset.xyxy;
  let clipRect = vec4f(max(own.xy, g.clip.xy), min(own.zw, g.clip.zw));
  let weight = roundedCoverage(lp, s.clipBounds, s.radii, at.scale) * clamp(s.params.x, 0.0, 1.0) * areaInAt(clipRect, p, at.scale) * cornerCoverageAt(own, s.maskRadii, p, at.scale) * cornerCoverageAt(g.clip, g.clipRadii, p, at.scale) * at.keep;
  if weight <= 0.0 { discard; }
  var uv = (lp - s.bounds.xy) / (s.bounds.zw - s.bounds.xy);
  let turn = u32(s.params.z);
  if turn == 1u { uv = vec2f(uv.y, 1.0 - uv.x); }
  if turn == 2u { uv = vec2f(1.0) - uv; }
  if turn == 3u { uv = vec2f(1.0 - uv.y, uv.x); }
  let q = s.bounds.xy + uv * (s.bounds.zw - s.bounds.xy);
  let flags = u32(s.params.y);
  var c: vec4f;
  if (flags & 2u) != 0u { c = nearestTile(s.tile, s.bounds, q); } else { c = sampleTile(s.tile, s.bounds, q); }
  if (flags & 1u) != 0u {
    let l = dot(c.rgb, vec3f(0.2126, 0.7152, 0.0722));
    c = vec4f(l, l, l, c.a);
  }
  return c * weight;
}
