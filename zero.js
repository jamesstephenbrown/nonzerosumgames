const canvas = document.querySelector('canvas')
const c = canvas.getContext('2d')

canvas.width = innerWidth
canvas.height = innerHeight
centre = {x: innerWidth/2, y:innerHeight/2}
// let square = document.getElementById("square");

class Neut {
	constructor (position, radius, color, goal, speed, mood) {
		// console.log('making neut')
		this.x = position.x
		this.y = position.y
		this.radius = radius
		this.goal = {x:0,y:0}
		this.color = color
		this.mood = mood
		this.speed = speed

		// console.log(this.x,this.y,this.radius,this.goal,this.color,this.mood,this.speed)
	}

	draw () {
	    c.beginPath()
	    c.arc(this.x, this.y, this.radius, 0, Math.PI * 2, false)
	    c.fillStyle = this.mood > 0 ? 'black': this.mood < 0 ? 'white' : 'grey'
	    c.fill()
	    c.closePath()
  		// c.drawImage(square, this.x,this.y)

	}

	update () {
		this.draw()
	}

	move () {
		this.x += this.goal.x
		this.y += this.goal.y
		// console.log(this.goal.x)
	}
  
	reactions() { 
		neuts.forEach((neut) => {
			if (neut != this) {
				let heading = {x: neut.x - this.x, y: neut.y - this.y}
		        const distance = Math.hypot(heading.x,heading.y)

		        const pullHeading = {x:heading.x / 100,y:heading.y / 100}
		        const pushHeading = {x:-heading.x / (distance * distance + 1),y:-heading.y / (distance * distance + 1)}

		        // this.goal.x = heading.x * neut.mood  // change this later to correspond to +- charge relationship
		        // this.goal.y = heading.y * neut.mood 

		        if (this.mood < 0) {
		        	if (neut.mood < 0) {
			        	this.goal.x = pushHeading.x * 1000 // change this later to correspond to +- charge relationship
			        	this.goal.y = pushHeading.y * 1000 
			        	// this.goal.x = pullHeading.x *10 // change this later to correspond to +- charge relationship
			        	// this.goal.y = pullHeading.y  *10
			        } else if (neut.mood > 0){
			        	this.goal.x = pullHeading.x  // change this later to correspond to +- charge relationship
			        	this.goal.y = pullHeading.y
			        	// this.goal.x = pushHeading.x * 10 *10// cange this later to correspond to +- charge relationship
			        	// this.goal.y = pushHeading.y * 10 *10
			        }
		        } else if (this.mood > 0) {
		        	if (neut.mood < 0) {
			        	this.goal.x = pushHeading.x * 1000
			        	this.goal.y = pushHeading.y * 1000
			        	// this.goal.x = pullHeading.x  // change this later to correspond to +- charge relationship
			        	// this.goal.y = pullHeading.y 
			        } else if (neut.mood > 0){

			        	// this.goal.x = pushHeading.x  // change this later to correspond to +- charge relationship
			        	// this.goal.y = pushHeading.y 
			        	this.goal.x = pullHeading.x  // change this later to correspond to +- charge relationship
			        	this.goal.y = pullHeading.y
			        }
		        }
			}
	        // console.log(this.goal.x,this.goal.y)
		})
	}
}


addEventListener('click', (event) => {

  neuts.forEach((neut) => {

		let heading = {x: event.clientX - neut.x, y: event.clientY - neut.y}
		const distance = Math.hypot(heading.x,heading.y)

		if (distance < neut.radius && neut.mood == 0) {

			neuts.push(new Neut(
			{x: neut.x + 30, y: neut.y}, // perhaps randomise
			11,
			'black',
			{x:0,y:0},
			5,
			1))

			neut.mood = -1
			neut.color = 'white'
			neut.x -= 30
		}
	})
})

const neuts = []

function findPosition() {
	let position = {
		x:centre.x + (Math.floor(Math.random()*10)*60) - 300,
		y:centre.y + (Math.floor(Math.random()*10)*60) - 300
	}
	neuts.forEach((neut) => {
		if (neut.x == position.x && neut.y == position.y) {
			position = findPosition()
		}
	})
	return position
}


function init () {
	for (var i = 20; i >= 0; i--) {
		neuts.push(new Neut(
			findPosition(),
			11,
			'grey',
			{x:0,y:0},
			5,
			0)
		)
	// console.log('neuts' + neuts[0].mood)
	}
}
function draw() {

    // Quadratric curves example
    c.beginPath();
    c.moveTo(75, 25);
    c.quadraticCurveTo(25, 25, 25, 62.5);
    c.quadraticCurveTo(25, 100, 50, 100);
    c.quadraticCurveTo(50, 120, 30, 125);
    c.quadraticCurveTo(60, 120, 65, 100);
    c.quadraticCurveTo(125, 100, 125, 62.5);
    c.quadraticCurveTo(125, 25, 75, 25);
    c.lineWidth = 10
    c.stroke();
}
function animate() {
  // console.log('animating')
	requestAnimationFrame(animate)
	c.fillStyle = 'rgba(50,50,50,1)'
	c.fillRect(0,0,canvas.width,canvas.height)

draw()

	neuts.forEach((neut) => {
  		neut.reactions()
  		neut.move()
		neut.update()
	})
}

init()
animate()