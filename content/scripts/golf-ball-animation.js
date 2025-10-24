// Golf Ball Animation System
// Triggers fun animations whenever a golfer is selected

class GolfBallAnimator {
    constructor() {
        this.animationContainer = null;
        this.isAnimating = false;
        this.selectedCount = 0;
        this.golfBallMessages = [
            "Great choice!",
            "Fore! Amazing pick!",
            "That's a birdie selection!",
            "Hole in one choice!",
            "Perfect swing!",
            "Eagle eye for talent!",
            "Championship pick!",
            "Pro-level selection!"
        ];
    }

    init() {
        this.createAnimationContainer();
        this.bindEvents();
        console.log('🏌️Golf Ball Animator initialized!');
    }

    createAnimationContainer() {
        // Remove existing container if it exists
        const existing = document.querySelector('.golf-ball-animation');
        if (existing) {
            existing.remove();
        }

        // Create new animation container
        this.animationContainer = document.createElement('div');
        this.animationContainer.className = 'golf-ball-animation';
        document.body.appendChild(this.animationContainer);
    }

    bindEvents() {
        // Listen for golfer selection changes
        const golferSelects = ['golfer1', 'golfer2', 'golfer3', 'golfer4'];
        
        golferSelects.forEach((selectId, index) => {
            const select = document.getElementById(selectId);
            if (select) {
                select.addEventListener('change', (event) => {
                    if (event.target.value) {
                        this.triggerGolfBallAnimation(index + 1, event.target.value);
                    }
                });
            }
        });
    }

    triggerGolfBallAnimation(golferNumber, golferName) {
        console.log(`🏌️‍♂️ Triggering animation for Golfer ${golferNumber}: ${golferName}`);
        
        // Prevent multiple simultaneous animations
        if (this.isAnimating) {
            setTimeout(() => this.triggerGolfBallAnimation(golferNumber, golferName), 500);
            return;
        }

        this.isAnimating = true;
        this.selectedCount++;

        // Create flying golf balls
        this.createFlyingGolfBalls(golferNumber);
        
        // Show success message
        this.showSuccessMessage(golferName, golferNumber);
        
        // Create celebration burst
        this.createCelebrationBurst();
        
        // Special effect for 4th golfer (lineup complete)
        if (golferNumber === 4 && this.isLineupComplete()) {
            this.triggerLineupCompleteEffect();
        }

        // Reset animation flag after animation completes
        setTimeout(() => {
            this.isAnimating = false;
        }, 3000);
    }

    createFlyingGolfBalls(golferNumber) {
        const ballCount = Math.min(5 + golferNumber, 12); // More balls for later selections
        
        for (let i = 0; i < ballCount; i++) {
            setTimeout(() => {
                this.createSingleGolfBall();
            }, i * 100); // Stagger the ball creation
        }
    }

    createSingleGolfBall() {
        const ball = document.createElement('div');
        ball.className = 'golf-ball';
        
        // Random starting position and trajectory
        const startX = Math.random() * window.innerWidth;
        const curveX = (Math.random() - 0.5) * window.innerWidth * 0.8;
        
        ball.style.setProperty('--start-x', `${startX}px`);
        ball.style.setProperty('--curve-x', `${curveX}px`);
        
        this.animationContainer.appendChild(ball);
        
        // Remove ball after animation
        setTimeout(() => {
            if (ball.parentNode) {
                ball.parentNode.removeChild(ball);
            }
        }, 3000);
    }

    showSuccessMessage(golferName, golferNumber) {
        // Remove existing message
        const existingMessage = document.querySelector('.golfer-selected-message');
        if (existingMessage) {
            existingMessage.remove();
        }

        const message = document.createElement('div');
        message.className = 'golfer-selected-message';
        
        const randomMessage = this.golfBallMessages[Math.floor(Math.random() * this.golfBallMessages.length)];
        message.innerHTML = `
            <div style="font-size: 20px; margin-bottom: 5px;">${randomMessage}</div>
            <div style="font-size: 16px; opacity: 0.9;">Selected: ${golferName}</div>
        `;
        
        document.body.appendChild(message);
        
        // Remove message after animation
        setTimeout(() => {
            if (message.parentNode) {
                message.parentNode.removeChild(message);
            }
        }, 3000);
    }

    createCelebrationBurst() {
        const burst = document.createElement('div');
        burst.className = 'celebration-burst';
        
        // Create burst particles
        const particleCount = 15;
        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'burst-particle';
            
            // Random burst direction
            const angle = (i / particleCount) * Math.PI * 2;
            const distance = 50 + Math.random() * 100;
            const x = Math.cos(angle) * distance;
            const y = Math.sin(angle) * distance;
            
            particle.style.setProperty('--burst-x', `${x}px`);
            particle.style.setProperty('--burst-y', `${y}px`);
            
            burst.appendChild(particle);
        }
        
        document.body.appendChild(burst);
        
        // Remove burst after animation
        setTimeout(() => {
            if (burst.parentNode) {
                burst.parentNode.removeChild(burst);
            }
        }, 2000);
    }

    isLineupComplete() {
        const golferSelects = ['golfer1', 'golfer2', 'golfer3', 'golfer4'];
        return golferSelects.every(selectId => {
            const select = document.getElementById(selectId);
            return select && select.value;
        });
    }

    triggerLineupCompleteEffect() {
        console.log('LINEUP COMPLETE! Triggering special effect!');
        
        // Create hole-in-one flash effect
        const holeInOneEffect = document.createElement('div');
        holeInOneEffect.className = 'hole-in-one-effect';
        document.body.appendChild(holeInOneEffect);
        
        // Extra golf balls for the celebration
        setTimeout(() => {
            for (let i = 0; i < 20; i++) {
                setTimeout(() => {
                    this.createSingleGolfBall();
                }, i * 50);
            }
        }, 500);
        
        // Show special completion message
        setTimeout(() => {
            const completionMessage = document.createElement('div');
            completionMessage.className = 'golfer-selected-message';
            completionMessage.innerHTML = `
                <div style="font-size: 24px; margin-bottom: 8px;">LINEUP COMPLETE!</div>
                <div style="font-size: 18px; opacity: 0.9;">Ready to dominate the course!</div>
            `;
            completionMessage.style.background = 'linear-gradient(135deg, #FFD700, #FFA500)';
            completionMessage.style.boxShadow = '0 8px 32px rgba(255, 215, 0, 0.6)';
            
            document.body.appendChild(completionMessage);
            
            setTimeout(() => {
                if (completionMessage.parentNode) {
                    completionMessage.parentNode.removeChild(completionMessage);
                }
            }, 4000);
        }, 1000);
        
        // Remove hole-in-one effect
        setTimeout(() => {
            if (holeInOneEffect.parentNode) {
                holeInOneEffect.parentNode.removeChild(holeInOneEffect);
            }
        }, 2000);
    }

    // Manual trigger for testing
    testAnimation() {
        this.triggerGolfBallAnimation(1, "Test Golfer");
    }
}

// Initialize the golf ball animator when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Small delay to ensure other scripts are loaded
    setTimeout(() => {
        const animator = new GolfBallAnimator();
        animator.init();
        
        // Make it globally available for testing
        window.golfBallAnimator = animator;
        
        console.log('Golf Ball Animation System Ready!');
        console.log('Test it with: golfBallAnimator.testAnimation()');
    }, 500);
}); 