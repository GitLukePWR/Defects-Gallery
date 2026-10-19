// Reference lists used to tag photos.
// Element names follow the standard UK highway-structure element breakdown
// (CS 450 / Inspection Manual for Highway Structures terminology).
export const ELEMENT_GROUPS = [
  { group: 'General', items: [
    'General view / overview',
    'Elevation',
    'Underside / soffit general',
  ]},
  { group: 'Deck', items: [
    'Primary deck element',
    'Transverse beams',
    'Secondary deck element',
    'Half joints',
    'Tie beam / rod',
    'Parapet beam or cantilever',
    'Deck bracing',
    'Arch barrel / ring',
    'Spandrel fill',
    'Cables / hangers / stays',
    'Post-tensioned tendons / anchorages',
  ]},
  { group: 'Load-bearing substructure', items: [
    'Foundations',
    'Abutments (incl. arch springings)',
    'Spandrel walls / head walls',
    'Piers / columns',
    'Cross-heads / capping beams',
    'Bearings',
    'Bearing plinths / shelves',
  ]},
  { group: 'Durability', items: [
    'Superstructure drainage',
    'Substructure drainage',
    'Waterproofing',
    'Movement / expansion joints',
    'Painting: deck elements',
    'Painting: substructure elements',
    'Painting: parapets / safety fences',
  ]},
  { group: 'Safety', items: [
    'Access / walkways / gantries',
    'Handrails / parapets / safety fences',
    'Carriageway surfacing',
    'Footway / verge / footbridge surfacing',
    'Invert / river bed',
    'Aprons',
    'Fenders / cutwaters / collision protection',
  ]},
  { group: 'Other', items: [
    'Wing walls',
    'Retaining walls',
    'Embankments',
    'Machinery',
    'Approach rails / barriers / walls',
    'Signs',
    'Lighting',
    'Services',
  ]},
];

export const ELEMENTS = ELEMENT_GROUPS.flatMap(g => g.items);
export const UNASSIGNED = 'Unassigned';

export const DEFECTS = [
  'No defect / record only',
  'Concrete',
  'Steel / metalwork',
  'Timber',
  'Masonry / brickwork',
  'Bearings',
  'Cables / hangers',
  'Post-tensioned elements',
  'Drainage',
  'Movement joints',
  'Surfacing',
  'Protective coatings / paint',
  'Vegetation / debris',
  'Scour / hydraulic',
];
