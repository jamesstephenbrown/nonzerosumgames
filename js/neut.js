const canvas = document.querySelector('canvas')
const c = canvas.getContext('2d')

canvas.width = innerWidth
canvas.height = innerHeight
centre = {x: innerWidth/2, y:innerHeight/2}
// let square = document.getElementById("square");

class Neut {
	constructor (position, width, height, color, heading, goal, speed, mood) {
		// console.log('making neut')
		this.x = position.x
		this.y = position.y
		this.width = width
		this.height = height
		this.color = color
		this.heading = heading
		this.frames = 0
		this.mood = mood
		this.change = 0
		this.back = {x:this.x,y:this.y}
		this.goal = {x:this.x,y:this.y}
		this.isMoving = false
		this.speed = speed
		this.isTouched = false
	}

	draw () {
		// ORIGINAL
	    // c.beginPath()
	    // c.rect(this.x,this.y,this.width,this.height)
	    // c.fillStyle = this.mood > 0 ? 'lightGreen':'red'
	    // c.fill()

	    // c.beginPath()
	    // const newSize = this.mood > 0 ? 22 - this.mood * 2 : 22 + this.mood * 2
	    // c.rect(this.x + this.width/2 - newSize/2,this.y + this.height/2 - newSize/2,newSize,newSize)
	    // c.fillStyle = 'grey'
	    // c.fill()


	    c.beginPath()
	    let newSize = this.mood > 0 ? this.mood * 2 + 4:this.mood < 0 ? -this.mood * 2 + 4 : 4

	    c.rect(this.x + this.width/2 - newSize/2,this.y + this.height/2 - newSize/2,newSize,newSize)
	    c.fillStyle = this.mood > 0 ? 'black': this.mood < 0 ? 'white' : 'grey'
	    c.fill()

  		// c.drawImage(square, this.x,this.y)

	}

	update () {
		this.mood = this.mood + this.change
		this.change = 0
		this.mood = this.mood > 11 ? 11 : this.mood < -11 ? -11 : this.mood
		// console.log('this is moving' + this.isMoving)
	  const moodSpeed = this.mood > 0 ? 12-this.mood : 12+this.mood

		if (this.isMoving) {
			if (this.goal.x < this.x) {
				this.x -= moodSpeed
			} else if (this.goal.x > this.x) {
				this.x += moodSpeed
			} else if (this.goal.y < this.y) {
				this.y -= moodSpeed
			} else if (this.goal.y > this.y) {
				this.y += moodSpeed
			}
		}
		this.draw()
	}

	move () {
		// set random movement
	  if (!this.isMoving && this != player && this.mood !=0) {

	  	const random = Math.floor(Math.random()*30)

		if (random == 0) {
			this.goal = {x:this.x,y:this.y + 30}
		} else if (random == 1) {
			this.goal = {x:this.x,y:this.y-30}
		} else if (random == 2) {
			this.goal = {x:this.x-30,y:this.y}
		} else if (random == 3) {
			this.goal = {x:this.x+30,y:this.y}
		}
			this.isMoving = true
	  }

	  const moodSpeed = this.mood > 0 ? 12-this.mood : 12+this.mood

	 	if (Math.abs(this.goal.x - this.x) < moodSpeed && Math.abs(this.goal.y - this.y) < moodSpeed && !this.isTouched) {
	 		// console.log('this should not be triggered until after movement')
	 		this.x = this.goal.x
	 		this.y = this.goal.y
	 		this.back.x = this.x
	 		this.back.y = this.y
	 		this.isMoving = false;
	 	}
	}

	collisions() {
		  neuts.forEach((neut) => {
		  	const distance = Math.hypot(this.x - neut.x, this.y - neut.y)
		  	// neuts colliding incl player
		  	if (distance < 20 && this != neut && !this.isTouched) {
			  	if (neut.mood > 0) {
			  		this.change += 1
			  	} else if (neut.mood < 0) {
			  		this.change -= 1
			  	}
			  	this.goal = this.back
			  	this.isTouched = true
		  	}

		  	if (distance < 20 && this != neut && !neut.isTouched) {
			  	if (this.mood > 0) {
			  		neut.change += 1
			  	} else if (this.mood < 0) {
			  		neut.change -= 1
			  	}
		  		neut.goal = neut.back
		  		neut.isTouched = true
		  	}

		  	// colliding with edge
		  	if (this.x < this.width||this.x > canvas.width - this.width||this.y < this.height||this.y > canvas.height - this.height) {
		  		this.goal = this.back
		  	}
		  	// need colliding with walls
		})
	}
}



class Player extends Neut {
}

const player = new Neut(centre, 22, 22, 'black', {x:0,y:0}, {x:0,y:0}, 5, 3)
// console.log('player position x: ' + player.x + ' y: ' + player.y)
const neuts = [player]


function findPosition() {
	let position = {
		x:centre.x + (Math.floor(Math.random()*20)*30) - 300,
		y:centre.y + (Math.floor(Math.random()*20)*30) - 300
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
			22,
			22,
			'black',
			{x:0,y:0},
			{x:0,y:0},
			5,
			Math.floor(Math.random()*22)-11)
		)
		// console.log('x: '+
		// 	(centre.x + Math.floor(Math.random()*10)*30 - 150) +
		// ' y: '+
		// (centre.y + Math.floor(Math.random()*10)*30 - 150)
		// )
	}
}



document.addEventListener('keydown', function(event) {
	
  if (event.defaultPrevented) {
    return; // Do nothing if the event was already processed
  }
  if (!player.isMoving) {
	if (event.key == "ArrowDown") {
		player.goal = {x:player.x,y:player.y+30}
		player.isMoving = true
	} else if (event.key == "ArrowUp") {
		player.goal = {x:player.x,y:player.y-30}
		player.isMoving = true
	} else if (event.key == "ArrowLeft") {
		player.goal = {x:player.x-30,y:player.y}
		player.isMoving = true
	} else if (event.key == "ArrowRight") {
		player.goal = {x:player.x+30,y:player.y}
		player.isMoving = true
	}
  }
  // Cancel the default action to avoid it being handled twice
  event.preventDefault();
}, true);




function animate() {
  // console.log('animating')
  requestAnimationFrame(animate)
  c.fillStyle = 'rgba(85,170,227,0.1)'
  c.fillRect(0,0,canvas.width,canvas.height)

player.isTouched = false
  neuts.forEach((neut) => {
  	neut.isTouched = false
  		neut.collisions()
  		neut.move()
		neut.update()
	})
  player.update()
  player.collisions()




}
init()
animate()