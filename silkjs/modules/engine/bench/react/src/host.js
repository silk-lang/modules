// A React renderer whose host does nothing: every instance is the same frozen object and
// every mutation is an empty function, so the time measured is React's and the engine's.
import Reconciler from "react-reconciler";
import { ConcurrentRoot, DefaultEventPriority } from "react-reconciler/constants.js";
import { createContext } from "react";

const NODE = Object.freeze({});
const HOST_CONTEXT = Object.freeze({});
export const counts = { elements: 0, texts: 0 };
let updatePriority = 0;
function nothing() {}
// The bundle needs no global of a host: an error React reports is thrown where it is reported.
function report(error) {
  throw error;
}

const reconciler = Reconciler({
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,
  noTimeout: -1,
  scheduleTimeout: nothing,
  cancelTimeout: nothing,
  supportsMicrotasks: false,
  getRootHostContext: () => HOST_CONTEXT,
  getChildHostContext: (parent) => parent,
  getPublicInstance: (instance) => instance,
  prepareForCommit: () => null,
  resetAfterCommit: nothing,
  createInstance() {
    counts.elements++;
    return NODE;
  },
  createTextInstance() {
    counts.texts++;
    return NODE;
  },
  appendInitialChild: nothing,
  finalizeInitialChildren: () => false,
  shouldSetTextContent: () => false,
  appendChild: nothing,
  appendChildToContainer: nothing,
  insertBefore: nothing,
  insertInContainerBefore: nothing,
  removeChild: nothing,
  removeChildFromContainer: nothing,
  commitUpdate: nothing,
  commitTextUpdate: nothing,
  commitMount: nothing,
  resetTextContent: nothing,
  hideInstance: nothing,
  hideTextInstance: nothing,
  unhideInstance: nothing,
  unhideTextInstance: nothing,
  clearContainer: nothing,
  detachDeletedInstance: nothing,
  preparePortalMount: nothing,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: nothing,
  afterActiveInstanceBlur: nothing,
  prepareScopeUpdate: nothing,
  getInstanceFromScope: () => null,
  setCurrentUpdatePriority(priority) {
    updatePriority = priority;
  },
  getCurrentUpdatePriority: () => updatePriority,
  resolveUpdatePriority: () => updatePriority || DefaultEventPriority,
  trackSchedulerEvent: nothing,
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  shouldAttemptEagerTransition: () => false,
  requestPostPaintCallback: nothing,
  maySuspendCommit: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: nothing,
  suspendInstance: nothing,
  waitForCommitToBeReady: () => null,
  NotPendingTransition: null,
  HostTransitionContext: createContext(null),
  resetFormInstance: nothing,
});

/** A root that renders and commits before `render` returns, passive effects included. */
export function createRoot() {
  const container = {};
  const root = reconciler.createContainer(container, ConcurrentRoot, null, false, null, "", report, report, report, null);
  return {
    render(element) {
      reconciler.updateContainerSync(element, root, null, null);
      reconciler.flushSyncWork();
      reconciler.flushPassiveEffects();
    },
    /** Commits whatever updates were scheduled since the last commit. */
    flush() {
      reconciler.flushSyncWork();
      reconciler.flushPassiveEffects();
    },
    sync(callback) {
      reconciler.flushSyncFromReconciler(callback);
      reconciler.flushPassiveEffects();
    },
  };
}
