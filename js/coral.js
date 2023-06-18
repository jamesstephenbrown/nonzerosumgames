
const cellSize = 30;

class Dot {
    constructor(x, y, color, size) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.size = size;
        this.fullSize = Math.floor(Math.random() * 14)+15;
        this.cloned = false;
        this.clonedTimer = 60;
    }

    grow(dt) {
        this.size += dt / 500;
        if (this.size > this.fullSize) {
            this.size = this.fullSize;
        }
    }

    canReproduce() {
        return this.size >= this.fullSize && (this.clonedTimer < 1);
    }

    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.x * cellSize + cellSize / 2, this.y * cellSize + cellSize / 2, this.size / 2, 0, 2 * Math.PI);
        ctx.fillStyle = this.color;
        ctx.fill();
    }

    update(dt, grid) {
        if (this.clonedTimer > 0) {
            this.clonedTimer -= 1;
        }
        this.grow(dt);
        if (this.canReproduce()) {
            const positions = grid.getAvailablePositions(this.x, this.y);
            if (positions.length > 0) {
                const pos = positions[Math.floor(Math.random() * positions.length)];
                const child = new Dot(pos.x, pos.y, this.color, 0);
                grid.addDot(child);
                this.clonedTimer = 60;
            }
        }
    }
}

class Grid {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.grid = Array(width).fill().map(() => Array(height).fill(null));
    }

    addDot(dot) {
        if (this.grid[dot.x][dot.y] === null) {
            this.grid[dot.x][dot.y] = dot;
            return true;
        }
        return false;
    }

    getAvailablePositions(x, y) {
        const positions = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height && this.grid[nx][ny] === null) {
                    positions.push({x: nx, y: ny});
                }
            }
        }
        return positions;
    }

    draw(ctx) {
        ctx.clearRect(0, 0, this.width * cellSize, this.height * cellSize);
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                if (this.grid[x][y] !== null) {
                    this.grid[x][y].draw(ctx);
                }
            }
        }
    }

    update(dt) {
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                if (this.grid[x][y] !== null) {
                    this.grid[x][y].update(dt, this);
                }
            }
        }
    }
}

let lastTime = Date.now();


const grid = new Grid(Math.floor((innerWidth-100) / cellSize)  , 20);
const canvas = document.querySelector('#canvas');
canvas.width = grid.width * cellSize;
canvas.height = grid.height * cellSize;
const ctx = canvas.getContext('2d');

function gameLoop() {
    const now = Date.now();
    const dt = now - lastTime;
    lastTime = now;
    grid.update(dt);
    grid.draw(ctx);
    requestAnimationFrame(gameLoop);
}

canvas.addEventListener('click', event => {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / cellSize);
    const y = Math.floor((event.clientY - rect.top) / cellSize);
    const colors = ['red', 'lightGreen', 'blue', 'yellow', 'pink'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const dot = new Dot(x, y, color, 10);
    grid.addDot(dot);
});

gameLoop();
