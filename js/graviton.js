
const canvas = document.querySelector('canvas')
const c = canvas.getContext('2d')

// element which needs to enter full-screen mode
var element = document.querySelector('canvas');

// make the element go to full-screen mode
//element.requestFullscreen()
//  .then(function() {
//    // element has entered fullscreen mode successfully
//  })
//  .catch(function(error) {
//    // element could not enter fullscreen mode
//  });

canvas.width = innerWidth
canvas.height = innerHeight

const mouse = {
  x: innerWidth / 2,
  y: innerHeight / 2
}

const numberOfElements = 4
const numberOfGravitons = 800
const attractionMin = -50
const attractionMax = 50
const red = 'rgb(255,100,100)'
const yellow = 'rgb(150,255,100)'
const blue = 'rgb(100,100,255)'
const orange = 'rgb(150,255,100)'
const green = 'rgb(40,100,255)'
const purple = 'rgb(200,50,200)'
const grey = 'rgb(150,150,150)'
const grass = 'rgb(0,255,0)'
const sky = 'rgb(150,150,255)'
const turquoise = 'rgb(0,200,100)'
const violet = 'rgb(100,0,150)'
const peach = 'rgb(255,180,100)'
const pink = 'rgb(255,0,100)'
const brown = 'rgb(200,150,100)'
const maroon = 'rgb(180,0,40)'
const navy = 'rgb(0,0,180)'


// Event Listeners
addEventListener('mousemove', (event) => {
  mouse.x = event.clientX
  mouse.y = event.clientY
})

addEventListener('resize', () => {
  canvas.width = innerWidth
  canvas.height = innerHeight
  init()
})




addEventListener('touchmove', (event) => {
  event.preventDefault();
  // Your existing code
}, { passive: false });


class Offset {
  constructor (x,y) {
    this.x = x
    this.y = y
  }
}

// Objects
class Graviton {
  constructor(index,x, y, radius, color, goal, element, attractions) {
    this.index = index
    this.x = x
    this.y = y
    this.radius = radius
    this.color = color
    this.goal = {x:0,y:0}
    this.element = element
    this.attractions = attractions
    this.cluster = 0
  }
  update () {
    gravitons.forEach(graviton => {
      if (this.index > graviton.index) {

        let heading = {x: graviton.x - this.x, y: graviton.y - this.y}
        const distance = Math.hypot(heading.x,heading.y);

        if (distance < 200) {
          this.cluster += 1
          graviton.cluster += 1
        }

        heading.x = heading.x / (distance)
        heading.y = heading.y / (distance)

        // console.log (this.attractions[graviton.element])

        const thisAttractionForGravitonElement = this.attractions [graviton.element]
        const gravitonAttractionForThisElement = -this.attractions [graviton.element]

        // console.log(thisAttractionForGravitonElement, graviotnAttractionForThisElement)
        
        const divider = 150

        this.goal.x += (heading.x * thisAttractionForGravitonElement) / divider
        this.goal.y += (heading.y * thisAttractionForGravitonElement) / divider

        graviton.goal.x += (heading.x * gravitonAttractionForThisElement) / divider
        graviton.goal.y += (heading.y * gravitonAttractionForThisElement) / divider
      }
    })
  }
  reset() {
    // draw()
    this.goal = {x:0,y:0}
    this.cluster = 0
  }

  draw() {
    // c.beginPath()
    // c.arc(this.x, this.y, this.radius, 0, Math.PI * 2, false)
    // c.fillStyle = this.color
    // c.fill()
    // c.closePath()
    c.beginPath()
    c.rect(this.x,this.y,3,3)
    c.fillStyle = this.color
    c.fill()
    // c.stroke()
  }
}

// Implementation
let gravitons
let elements

let offset = new Offset (0,0)

function init() {
  //element.requestFullscreen()

  c.fillStyle = '#3a3a3a'
  c.fillRect(0,0,canvas.width,canvas.height)
  // console.log('initializing')
  elements = []

  for (let i = 0; i < numberOfElements; i++) {

    attractions = [];

    for (let n = 0; n < numberOfElements; n++) {
      const random = (Math.random() * (attractionMax * 2)) + attractionMin
      attractions.push(random); // not sure if "new float" is correct syntax
    }
    elements.push (attractions);
  }

  gravitons = []
  for (let i = 0; i < numberOfGravitons; i++) {

    const x = Math.random() * innerWidth
    const y = Math.random() * innerHeight

    const element = randomIntFromRange (0, numberOfElements - 1) // perhaps numberOfElements - 1
    const attractions = elements [element];
    const index = i;
  // instead of a 2d array - you could just check the remainder after dividing by the number of elements

    const color =
    (element == 0) ? red :
    (element == 1) ? yellow:
    (element == 2) ? blue :
    (element == 3) ? purple :
    (element == 4) ? green :
    (element == 5) ? orange :
    (element == 6) ? grey :
    (element == 7) ? grass :
    (element == 8) ? sky :
    (element == 9) ? turquoise:
    (element == 10) ? violet :
    (element == 11) ? peach :
    (element == 12) ? pink :
    (element == 13) ? brown :
    (element == 14) ? maroon :
    (element == 15) ? navy :
    'white';

    const radius = 10
    const goal = {x:0,y:0}
    gravitons.push(new Graviton (index,x,y,radius,color,goal,element,attractions))
  }
}

init()
let mostPopular = gravitons[0]
  
let persistent = {x:canvas.width,y:canvas.height}

// Animation Loop
function animate() {
  // console.log('animating')
  requestAnimationFrame(animate)
  c.fillStyle = 'black'
  c.fillRect(0,0,canvas.width,canvas.height)
  gravitons.forEach(graviton => {
   graviton.reset()
  })
  gravitons.forEach(graviton => {
   graviton.update()
   if (graviton.cluster > mostPopular.cluster ) {
    mostPopular = graviton
   }
  })

let clusterCount = 0
let averageX = 0
let averageY = 0

  gravitons.forEach(graviton => {
    if(distance(graviton.x,graviton.y,mostPopular.x,mostPopular.y) < 100) {
      clusterCount += 1
      averageX += graviton.x
      averageY += graviton.y
    }
   })

  averageX = averageX / clusterCount
  averageY = averageY / clusterCount

  mostPopular = {x:averageX,y:averageY,cluster:clusterCount}

  smoothing = 100
  gravitons.forEach(graviton => {
    offset.x = ((mostPopular.x) - canvas.width + (persistent.x - canvas.width)*smoothing) / (smoothing+1)
    offset.y = ((mostPopular.y) - canvas.height + (persistent.y - canvas.height)*smoothing) / (smoothing+1)

    graviton.x += graviton.goal.x - canvas.width / 2
    graviton.y += graviton.goal.y - canvas.height / 2
    graviton.x -= offset.x
    graviton.y -= offset.y



//     const limit = canvas.height / 2;
//     const centre = { x: canvas.width / 2, y: canvas.height / 2 }
//     const dist = distance(centre.x,centre.y,0,graviton.x,graviton.y,graviton.z)
//     const headingEdge = {x: ((graviton.x-mostPopular.x) / dist)*limit, y: ((graviton.y-mostPopular.y) / dist)*limit, z: (graviton.z / dist)*limit};
// console.log("graviton ", graviton.x, graviton.y, graviton.z, "headingEdge ", headingEdge.x, headingEdge.y, headingEdge.z)
//     if (dist > limit) {
//       graviton.x -= 2*headingEdge.x;
//       graviton.y -= 2*headingEdge.y;
//       graviton.z -= 2*headingEdge.z
    // }
    
      // graviton.x = graviton.x < 0 ? graviton.x + canvas.width : graviton.x > canvas.width ? graviton.x - canvas.width : graviton.x;
      // graviton.y = graviton.y < 0 ? graviton.y + canvas.height : graviton.y > canvas.height ? graviton.y - canvas.height : graviton.y;
      // graviton.z = graviton.z < 0 ? graviton.z + canvas.width : graviton.z > canvas.width ? graviton.z - canvas.width : graviton.z;

    graviton.draw()

    persistent = mostPopular
  })
}
function distance(x1, y1, x2, y2) {
  return Math.hypot(x2-x1,y2-y1);
}

function randomIntFromRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min)
}

function randomColor(colors) {
  return colors[Math.floor(Math.random() * colors.length)]
}
animate()

// module.exports = { randomIntFromRange, randomColor, distance }


// function product3x3(x1, y1, z1, x2, y2, z2) { return new {x: x1 * x2, y: y1 * y2, z: z1 * z2} }
// function product(x1, y1, z1, float f) { return new {x: x1 * f, y: y1 * f, z: z1 * f} }
// function divided(x1, y1, z1, float f) { return new {x: x1 / f, y: y1 / f, z: z1 / f} }
