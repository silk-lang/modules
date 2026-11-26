// @silkui/foldkit comes first: it provides the `document` Foldkit renders through.
import '@silkui/foldkit'
import { Runtime } from 'foldkit'

import { Model, init, update, view } from './main'

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  container: document.getElementById('root'),
})

Runtime.run(application)
// Two animation frames after the first render, that frame is on screen. The React starter
// prints the same line.
requestAnimationFrame(() => requestAnimationFrame(() => console.log('foldkit starter: first frame')))
