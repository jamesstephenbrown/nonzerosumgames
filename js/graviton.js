const canvas = document.querySelector('canvas')
const c = canvas.getContext('2d')
canvas.width = innerWidth
canvas.height = innerHeight

const numberOfElements = 16

const numberOfGravitons = 1500
const attractionMin = -100
const attractionMax = 100
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



const gridSize = 50
let grid = new Map()

function getKey(x, y) {
  return `${Math.floor(x / gridSize)},${Math.floor(y / gridSize)}`
}
function colorFromElement(element) {
  const hue = (element * 137) % 360 // golden angle ensures good separation
  const saturation = 70
  const lightness = 60
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`
}

const simulationSize = Math.min(canvas.width, canvas.height) * 2
const simCenterX = canvas.width / 2
const simCenterY = canvas.height / 2
const zoom = 3  // you can adjust this

class Graviton {
  constructor(index, x, y, radius, color, element, attractions) {
    this.index = index
    this.x = x
    this.y = y
    this.oX = x
    this.oY = y
    this.radius = radius
    this.color = color
    this.goal = { x: 0, y: 0 }
    this.element = element
    this.attractions = attractions
    this.cluster = 0
  }

  reset() {
    this.oX = this.x
    this.oY = this.y
    this.goal.x = 0
    this.goal.y = 0
    this.cluster = 0
  }

  update() {
    for (let other of gravitons) {
      if (this.index >= other.index) continue

      const dx = other.oX - this.oX
      const dy = other.oY - this.oY
      const distSq = dx * dx + dy * dy
      if (distSq > 100000) continue  // ignore beyond 400px

      const distance = Math.sqrt(distSq) + 1e-4
      const decay = 1 / (distSq + 1000)
      this.cluster += 1
      other.cluster += 1

      const headingX = dx / distance
      const headingY = dy / distance
      const att1 = this.attractions[other.element]
      const att2 = -att1

      this.goal.x += headingX * att1 * decay
      this.goal.y += headingY * att1 * decay
      other.goal.x += headingX * att2 * decay
      other.goal.y += headingY * att2 * decay
    }
  }

  draw() {
    const drawX = (this.x - simCenterX) * zoom + canvas.width / 2
    const drawY = (this.y - simCenterY) * zoom + canvas.height / 2
    if (drawX < 0 || drawX > canvas.width || drawY < 0 || drawY > canvas.height) return
    c.beginPath()
    c.rect(drawX, drawY, 2, 2)
    c.fillStyle = this.color
    c.fill()
  }
}

let gravitons = []
let elements = []


function init() {
  elements = []
  for (let i = 0; i < numberOfElements; i++) {
    let attractions = []
    for (let n = 0; n < numberOfElements; n++) {
      const random = (Math.random() * (attractionMax * 2)) + attractionMin
      attractions.push(random)
    }
    elements.push(attractions)
  }

  const spread = simulationSize / 4
  gravitons = []
  for (let i = 0; i < numberOfGravitons; i++) {
    const x = simCenterX + (Math.random() - 0.5) * spread
    const y = simCenterY + (Math.random() - 0.5) * spread
    const element = Math.floor(Math.random() * numberOfElements)
    const attractions = elements[element]
    const color =
      (element == 0) ? red :
      (element == 1) ? yellow :
      (element == 2) ? blue :
      (element == 3) ? purple :
      (element == 4) ? green :
      (element == 5) ? orange :
      (element == 6) ? grey :
      (element == 7) ? grass :
      (element == 8) ? sky :
      (element == 9) ? turquoise :
      (element == 10) ? violet :
      (element == 11) ? peach :
      (element == 12) ? pink :
      (element == 13) ? brown :
      (element == 14) ? maroon :
      (element == 15) ? navy :
      colorFromElement(element);
        
    gravitons.push(new Graviton(i, x, y, 3, color, element, attractions))
  }
}

init()

function animate() {
  requestAnimationFrame(animate)
  c.fillStyle = 'black'
  c.fillRect(0, 0, canvas.width, canvas.height)

  // Optional: draw bounding box
  const boxSize = simulationSize * zoom
  c.strokeStyle = 'rgba(85,170,227,0.2)'
  c.lineWidth = 1
  c.strokeRect(
    (canvas.width - boxSize) / 2,
    (canvas.height - boxSize) / 2,
    boxSize,
    boxSize
  )

  // Grid setup
  grid.clear()
  gravitons.forEach(g => {
    g.reset()
    const key = getKey(g.x, g.y)
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key).push(g)
  })

  // Update and draw
  gravitons.forEach(g => {
    g.update()
    g.x += g.goal.x
    g.y += g.goal.y
    g.draw()
  })
}

animate()