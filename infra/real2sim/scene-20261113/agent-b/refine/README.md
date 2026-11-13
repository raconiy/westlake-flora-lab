# Agent B additive refine layer

This directory contains a browser-side refinement layer for the Agent B scene.
It is deliberately additive: the original Blender/CG generators, measurements,
glTF assets, and `viewer.js` remain unchanged. The web page loads `web/refine.js`
after the original viewer has finished loading, then adds instanced grass,
low planting islands, a few small trees, flower beds, and benches to the same
Three.js scene.

`refine.json` records the seed, coordinate frame, ground zones, and the inferred
central planting positions. The central planting is marked as inferred because
the existing capture does not provide a fresh survey of every object in the
middle of the lawn. Toggle the layer with the `细化层` button in the page toolbar.
