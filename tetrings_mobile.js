window.onload = function() {
    let canvas = document.getElementById("gameCanvas");
    let context = canvas.getContext("2d");
    let centre = { x: canvas.width / 2, y: canvas.height / 2 };
  
    // tetrominoes

    let score = 0;
    let ms = 1000;
    let width = 4;
    let height = 16;
    let unitSize = 50;
    let origin = {x:width/2,y:2,z:0};
    let scale;

    let tet1 = [origin,{x:0,y:0,z:0},{x:-1,y:0,z:0},{x:1,y:0,z:0},{x:2,y:0,z:0}];
    let tet2 = [origin,{x:0,y:0,z:0},{x:1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:0,z:1}];
    let tet3 = [origin,{x:0,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:1,z:0},{x:1,y:1,z:0}];
    let tet4 = [origin,{x:0,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:1,z:-1}];
    let tet5 = [origin,{x:0,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:1,z:1}];
    let tet6 = [origin,{x:0,y:0,z:0},{x:1,y:0,z:0},{x:1,y:1,z:0},{x:0,y:1,z:0}];
    let tet7 = [origin,{x:0,y:0,z:0},{x:-1,y:0,z:0},{x:1,y:0,z:0},{x:1,y:1,z:0}];
    let tet8 = [origin,{x:0,y:0,z:0},{x:-1,y:0,z:0},{x:1,y:0,z:0},{x:0,y:1,z:0}];

    let tets = [tet1,tet2,tet3,tet4,tet5,tet6,tet7,tet1,tet2,tet3,tet6,tet7,tet1,tet8,tet8];

    let previousLinesRemoved = 0;
    var bloop = new Audio('bloop.mp3');
    var bleep = new Audio('bleep.mp3');
    let tetColours = [
        hue(0), hue(128),hue(32),hue(160),hue(64),hue(192),hue(96),hue(0),hue(128),hue(32),hue(160),hue(64),hue(192),hue(96),hue(0),hue(224),hue(224)];
    let tet = []; // setting tet to origin
    let tetColour = tetColours[0];
    let start = false;
    let pile = [{x: 0,y: 0,z: 0}];

    let rainbowStart = 0;
    let rainbowCurrent = 0;
    let rainbow = false;

    let startX, startY, startTime;
    let swipeDirection = null;
    let initiationThreshold = 20;

document.addEventListener('touchstart', function(e) {
    e.preventDefault();
    if (!start) startGame();
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
    swipeDirection = null; // Reset the swipe direction on touch start
}, { passive: false });

document.addEventListener('touchmove', function(e) {
    e.preventDefault();
    if (swipeDirection) return; // If the direction is already determined, ignore further moves

    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;

    let swipeX = x - startX;
    let swipeY = y - startY;

    if (Math.abs(swipeX) > initiationThreshold) {
        swipeDirection = swipeX > 0 ? 'right' : 'left';
        moveTet(swipeDirection === 'right' ? "d" : "a");
        startX = x; // Reset the start position for continuous swiping
    } else if (Math.abs(swipeY) > initiationThreshold) {
        swipeDirection = swipeY > 0 ? 'down' : 'up';
        // Put your logic for swipe up or down here based on swipeDirection
        if (swipeDirection === 'down') moveTet(startX < window.innerWidth / 2 ? "s" : "x");
        if (swipeDirection === 'up') moveTet("w");
        startY = y; // Reset the start position for continuous swiping
    }
}, { passive: false });

document.addEventListener('touchend', function(e) {
    e.preventDefault();
    let x = e.changedTouches[0].clientX;
    let y = e.changedTouches[0].clientY;
    let endTime = Date.now();

    let dist = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2));
    let time = endTime - startTime;

    if (dist < initiationThreshold && time < 200) {
        let centerX = window.innerWidth / 2;
        let centerY = window.innerHeight / 2;

        if (Math.abs(x - centerX) > Math.abs(y - centerY)) {
            if (x < centerX) rotateTet("ArrowLeft");
            else rotateTet(".");
        } else {
            if (y < centerY) rotateTet(",");
            else rotateTet("ArrowDown");
        }
    }

    swipeDirection = null; // Reset the swipe direction when the touch ends
}, { passive: false });

    
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
    }, { passive: false });
    function hue(number) {
        return "hsl(" + (number) + ", 100%, 75%)";
    }
    // draw screen
    function drawScreen(message) {
        console.log("Drawing start screen");
    
        // Calculate the center using unscaled dimensions
        let unscaledWidth = canvas.width / scale;
        let unscaledHeight = canvas.height / scale;
    
        // Save the current context state
        context.save();
    
        // Reset the transformation matrix
        context.setTransform(1, 0, 0, 1, 0, 0);
    
        // Clear the entire canvas
        context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    
        // Restore the previous context state
        context.restore();
    
        const title = "T3TRINGS";
        const instructions = message;
        context.fillStyle = "white";
        context.font = "40px MoreSugar";
    
        let textWidth = context.measureText(title).width;
        let centerX = unscaledWidth / 2 - textWidth / 2;
        context.fillText(title, centerX, unitSize * 2);
    
        const lines = instructions.split('\n');
        const lineHeight = unitSize;
        let yPosition = unitSize * 3;
    
        lines.forEach(line => {
            textWidth = context.measureText(line).width;
            centerX = unscaledWidth / 2 - textWidth / 2;
            context.fillText(line, centerX, yPosition);
            yPosition += lineHeight;
        });
    }
    function startGame() {
        console.log("Starting game");
        start = true;
        newTet();
    }
    document.addEventListener('keydown', function(event) {
        if (event.key == "Enter") {
            startGame();
        } else {
            if (!start) return;
            rotateTet(event.key);
            moveTet(event.key);
        }
    });
    function findCentre() {

        // find the block that is furthest from the origin in each direction

        let xMax = 0;
        let xMin = 0;
        let yMax = 0;
        let yMin = 0;
        let zMax = 0;
        let zMin = 0;

        for (let i = 1; i < tet.length; i++) {
            xMax = tet[i].x > xMax ? tet[i].x : xMax;
            xMin = tet[i].x < xMin ? tet[i].x : xMin;
            yMax = tet[i].y > yMax ? tet[i].y : yMax;
            yMin = tet[i].y < yMin ? tet[i].y : yMin;
            zMax = tet[i].z > zMax ? tet[i].z : zMax;
            zMin = tet[i].z < zMin ? tet[i].z : zMin;
        }
        let x = (xMax + xMin) % 2 === 0 ? (xMax + xMin) / 2 : 0;
        let y = (yMax + yMin) % 2 === 0 ? (yMax + yMin) / 2 : 0;
        let z = (zMax + zMin) % 2 === 0 ? (zMax + zMin) / 2 : 0;

        return { x, y, z };
    }
    // create new tetronimo function
    function newTet() {
        let newOrigin = {x:width/2,y:2,z:0};
        let index = Math.floor(Math.random() * tets.length);
        // Create a new copy of the tetromino array
        tet = tets[index].map(block => ({...block}));
        tetColour = tetColours[index];
        tet[0] = newOrigin;
        draw(tet, tetColour);
    }
    function rotateTet(key) {
        bloop.play();
        let tetCopy = JSON.parse(JSON.stringify(tet));
        let centre = findCentre();
        // subtract centre from all blocks
        tet.forEach(block => {
            block.x -= centre.x;
            block.y -= centre.y;
            block.z -= centre.z;
        });
        function swapAndNegate(xyz, index1, index2, negateIndex2) {

            for (let i = 1; i < tet.length; i++) {
                const temp = tet[i][xyz[index1]];
                tet[i][xyz[index1]] = negateIndex2 ? -tet[i][xyz[index2]] : tet[i][xyz[index2]];
                tet[i][xyz[index2]] = temp;
            }
        }
        const xyz = ['x', 'y', 'z'];
        if (key === "ArrowUp") {
            swapAndNegate(xyz, 1, 2, true);
        } else if (key === "ArrowDown") {
            swapAndNegate(xyz, 2, 1, true);
        } else if (key === "ArrowLeft") {
            swapAndNegate(xyz, 0, 2, true);
        } else if (key === "ArrowRight") {
            swapAndNegate(xyz, 2, 0, true);
        } else if (key === ".") { // Dvorak = v
            swapAndNegate(xyz, 0, 1, true);
        } else if (key === ",") { // Dvorak = w
            swapAndNegate(xyz, 1, 0, true);
        }   
        // add centre to all blocks
        tet.forEach(block => {
            block.x += centre.x;
            block.y += centre.y;
            block.z += centre.z;
        }
        );
        // Check if the new rotation will collide with the pile
        if (willCollide(tet[0].x, tet[0].y, tet[0].z, tet)||checkBounds() === false) {
            console.log("Can't rotate");
            tet = JSON.parse(JSON.stringify(tetCopy));
            return;
        }

        draw(tet, tetColour);
    }
    function moveTet(key) {
        let x = 0;
        let z = 0;

        // QWERTY Controls
        x = key === "a"? -1 : key === "d"? 1 : 0;
        z = key === "w"? -1 : key === "s"? 1 : 0;
        y = key === "x" ? 1 : 0;

        // Dvorak Controls
        // x = key === "a"? -1 : key === "e"? 1 : 0;
        // z = key === ","? -1 : key === "o"? 1 : 0;
        // y = key === "q" ? 1 : 0;

        if(move(tet,x,y,z)) {
            draw(tet, tetColour);
        }
    }
    function checkBounds() {
        for (let i = 1; i < tet.length; i++) {
            let x = tet[0].x + tet[i].x;
            let y = tet[0].y + tet[i].y;
            let z = tet[0].z + tet[i].z;
            if (x < 1) { // hit left
                if (move(tet, 1-x, 0, 0) == false) {
                    return false;
                }
            } else if (x > width) { // hit right
                if (move(tet, width-x, 0, 0) == false) {
                    return false;
                }
            }
            if (z > 2) {// "hit front"
                if (move(tet, 0, 0, 2-z) == false) {
                    return false;
                }
            } else if (z < -1) {// "hit back"
                if (move(tet, 0, 0, -1-z) == false) {
                    return false;
                }
            }
            if (y > 16) {
                return false;
            }

        }
    }
    function willCollide(x, y, z, thisTet) {
        for (let i = 1; i < thisTet.length; i++) {
            let newX = x + thisTet[i].x;
            let newY = y + thisTet[i].y;
            let newZ = z + thisTet[i].z;
            
            // Check if any block in the pile occupies the new position
            for (let j = 1; j < pile.length; j++) {
                if (pile[j].x === newX && pile[j].y === newY && pile[j].z === newZ) {
                    return true;
                }
            }
        }
        return false;
    }
    function move(thisTet,x,y,z) {
        // This moves if it can move and returns false if it can't move, so it can be used to check if movement is possible
    
        let canMove = true;
    
        for (let i = 1; i < thisTet.length; i++) {
            let newX = thisTet[0].x + thisTet[i].x + x;
            let newY = thisTet[0].y + thisTet[i].y + y;
            let newZ = thisTet[0].z + thisTet[i].z + z;
    
            if (newX < 1 || newX > width || newZ > 2 || newZ < -1) {
                console.log("Hit side");
                canMove = false;
            }
    
            // Check collisions with the pile with horizontal movement
            for (let j = 1; j < pile.length; j++) {
                if (pile[j].x === newX && pile[j].y === newY && pile[j].z === newZ) {
                    console.log("Hit pile");
                    canMove = false;
                }
            }
    
            // Only check for bottom collisions when moving down
            if (y > 0 && (willCollide(thisTet[0].x, thisTet[0].y + 1, thisTet[0].z, thisTet) || newY > 16)) {
                console.log("Reached bottom with new y of ", newY, " and old y of ", thisTet[0].y);

                if (thisTet[0].y < 4 ) {
                    start = false;
                    drawScreen("GAME OVER\n\nbut well\ndone, you\nscored\n\n" + score + "\n\nPress\nenter to\nrestart");
                    pile = [{x: 0,y: 0,z: 0}];
                } else {
                    addToPile(thisTet);
                }
                canMove = false;
                return false;
            }
        }
        
        if (canMove) {
            thisTet[0].x += x;
            thisTet[0].y += y;
            thisTet[0].z += z;

            if (y === 0) {
                bloop.play();
            }
        }
        return canMove;
    }
    function addToPile(thisTet) {
        // Temporary pile to store blocks of the landed tetromino
        let temporaryPile = [];
    
        for (let j = 1; j < thisTet.length; j++) {
            let pileBlock = {
                x: thisTet[0].x + thisTet[j].x,
                y: thisTet[0].y + thisTet[j].y,
                z: thisTet[0].z + thisTet[j].z,
                oz: thisTet[0].z
            };
            temporaryPile.push(pileBlock);
        }
    
        // Add temporaryPile to the actual pile
        pile = pile.concat(temporaryPile);
    
        // Check and remove complete lines
        checkAndRemoveLines();
        newTet();
    }
    function draw(tet, tetColour) {

        // Save the current context state
        context.save();
    
        // Reset the transformation matrix
        context.setTransform(1, 0, 0, 1, 0, 0);
    
        // Clear the entire canvas
        context.clearRect(0, 0, window.innerWidth, window.innerHeight);

        // drawX();
    
        // Restore the previous context state
        context.restore();
    
        drawScore();
        drawTet(tet, tetColour);
        drawTet(pile, "white");
    }
    function drawTet(thisTet, thisTetColour) {
        console.log("Drawing tet");


        context.lineWidth = 4;

        for (let i = 1; i < thisTet.length; i++) {


            if (rainbow) {
                let colourNumber = thisTet[i].y < rainbowStart ? thisTet[i].y + (rainbowCurrent - rainbowStart) : thisTet[i].y - (rainbowCurrent - rainbowStart);

                let rainbowColour = "hsl(" + (colourNumber * 16) + ", 100%, 75%)";
                context.strokeStyle = rainbowColour;
            } else {
                context.strokeStyle = thisTetColour;
                rainbowStart = 0;
            }


            context.beginPath();

            let oz = thisTet[i].oz != null? thisTet[i].oz : thisTet[0].z;
            let z = thisTet[i].oz != null? thisTet[i].z - thisTet[i].oz : thisTet[i].z;


            let x = thisTet[0].x * unitSize + (thisTet[i].x *unitSize);
            let y = thisTet[0].y * unitSize + (thisTet[i].y *unitSize);
            let radius = ((z + oz + 1.4) * 6);
            context.arc(x, y, radius, 0, 2 * Math.PI,false);
            context.stroke();
        }
    }
    function drawScore() {
        const scoreText = score;
        context.fillStyle = "white";
        context.font = "40px MoreSugar";
        const textWidth = context.measureText(scoreText).width;
        const centerX = canvas.width / 2 - textWidth / 2;
        context.fillText(scoreText, centerX, unitSize);
    }
    function checkAndRemoveLines() {
        let linesRemoved = 0;
        // Iterate through the Y levels
        for (let y = 16; y > 0; y--) {
            let filledLevels = [];
    
            // Check all X points for each Z level at this Y
            for (let z = -1; z <= 2; z++) {
                if (isLineFilled(y, z)) {
                    filledLevels.push(z);
                    rainbow = true;
                    rainbowStart = y;
                    rainbowCurrent = 16;
                }
            }
    
            if (filledLevels.length > 0) {
                removeLine(y, filledLevels);
                linesRemoved += filledLevels.length;
            }
        }

        let linesCombo = linesRemoved + previousLinesRemoved;

        if (linesRemoved > 0) {
            bleep.play();
            score += 200 * Math.pow(2, linesCombo - 1) - 100;
            previousLinesRemoved = linesCombo;
        } else {
            previousLinesRemoved = 0;
            rainbow = false;
        }
    
        return linesRemoved;
    }
    function isLineFilled(y, z) {
        for (let x = 1; x <= width; x++) {
            let filled = false;
            for (let block of pile) {
                if (block.x === x && block.y === y && block.z === z) {
                    filled = true;
                    break;
                }
            }
            if (!filled) return false;
        }
        return true;
    }
    function removeLine(y, filledLevels) {
        // Remove the blocks that are part of the filled lines
        pile = pile.filter((block, index) => {
            return index === 0 || !(block.y === y && filledLevels.includes(block.z));
        });
    }
    // Check for cleared levels and drop blocks above them
    function dropBlocksAboveClearedLevels() {
        for (let y = 1; y <= 16; y++) {
          if (isLevelClear(y)) { // You will need to define this function
            for (let i = 1; i < pile.length; i++) { // Start from index 1
              let block = pile[i];
      
              if (block.y < y) {
                block.y += 1; // Move the block down by one step
              }
            }
          }
        }
      }
    function isLevelClear(y) {
    for (let i = 1; i < pile.length; i++) { // Start from index 2 to ignore index 1
        let block = pile[i];
        if (block.y === y) {
        return false; // A block exists at this level, so it's not clear
        }
    }
    return true; // No blocks found at this level, so it's clear
    }
    setInterval(function() {
        console.log("Start = " + start);
        if (!start) return;
        if(move(tet, 0, 1, 0)) {
            draw(tet, tetColour);
        }

        rainbowCurrent -= rainbowCurrent > 0 ? 1 : 16;
        dropBlocksAboveClearedLevels();
    }, ms);
    resizeCanvas();
    document.fonts.load('40px MoreSugar').then(() => {
        drawScreen("tap to\nplay\n");
    });
    window.addEventListener('resize', resizeCanvas, false);
    function resizeCanvas() {

        const originalHeight = (height+1) * unitSize; // Your original game height
        const originalWidth = (width+1) * unitSize; // Your original game width

        const targetHeight = window.innerHeight * 0.8;
        scale = targetHeight / originalHeight;
        
        canvas.height = targetHeight;
        canvas.width = originalWidth * scale;

        centre = {
          x: canvas.width / 2,
          y: canvas.height / 2
        };

        // Apply scaling to the context
        context.setTransform(scale, 0, 0, scale, 0, 0);
        console.log("New centre after resize: ", centre);

        // redraws the game state
        if(start) {
            draw(tet, tetColour)
        } else {
            drawScreen("tap to\nplay\n");
        }
      }
  }
  