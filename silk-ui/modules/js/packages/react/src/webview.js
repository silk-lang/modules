// <WebView>: a real browser page shown over a box, through @silkui/core's createWebView.
import { createElement, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { createWebView } from "@silkui/core";

const EVENTS = {
  onLoadStart: "loadstart",
  onLoadProgress: "loadprogress",
  onLoadEnd: "loadend",
  onUrlChange: "urlchange",
  onTitleChange: "titlechange",
  onFaviconChange: "faviconchange",
  onHistoryChange: "historychange",
  onNavigationRequest: "navigationrequest",
  onNewWindow: "newwindow",
  onFocusChange: "focuschange",
  onConsole: "console",
  onUnsupported: "unsupported",
  onCrashed: "crashed",
  onClosed: "closed",
};

/**
 * A box with a web view over it. `src` is the page (changing it navigates), `profile`,
 * `inspectable`, `askBeforeNavigating` and `transparent` are fixed for the view's life
 * (changing one opens a new view). `zoom`, `colorScheme`, `muted` and `shown` follow their
 * props. `ref` gets the @silkui/core `WebView`, for navigation, find, scripts and agent calls.
 * The other props go to the box.
 */
export function WebView({
  src = "",
  profile = "",
  inspectable = true,
  askBeforeNavigating = false,
  transparent = false,
  zoom,
  colorScheme,
  muted,
  shown = true,
  ref,
  ...rest
}) {
  const node = useRef(null);
  const view = useRef(null);
  const handlers = useRef(rest);
  handlers.current = rest;

  useLayoutEffect(() => {
    const opened = createWebView(node.current, { url: src, profile, inspectable, askBeforeNavigating, transparent });
    view.current = opened;
    for (const [prop, type] of Object.entries(EVENTS)) {
      opened.addEventListener(type, (event) => handlers.current[prop]?.(event));
    }
    return () => {
      opened.close();
      if (view.current === opened) view.current = null;
    };
  }, [profile, inspectable, askBeforeNavigating, transparent]);

  useImperativeHandle(ref, () => view.current, [profile, inspectable, askBeforeNavigating, transparent]);

  useEffect(() => {
    const current = view.current;
    if (current && src && current.url !== src) current.navigate(src);
  }, [src]);
  useEffect(() => {
    if (zoom != null) view.current?.setZoom(zoom);
  }, [zoom, profile, inspectable, askBeforeNavigating, transparent]);
  useEffect(() => {
    if (colorScheme != null) view.current?.setColorScheme(colorScheme);
  }, [colorScheme, profile, inspectable, askBeforeNavigating, transparent]);
  useEffect(() => {
    if (muted != null) view.current?.setAudioMuted(muted);
  }, [muted, profile, inspectable, askBeforeNavigating, transparent]);
  useEffect(() => {
    view.current?.setShown(shown);
  }, [shown, profile, inspectable, askBeforeNavigating, transparent]);

  const boxProps = {};
  for (const key in rest) if (!(key in EVENTS)) boxProps[key] = rest[key];
  boxProps.ref = node;
  return createElement("box", boxProps);
}
