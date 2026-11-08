# Velvet Royale Online

A shareable, real-time Texas Hold'em poker room for friends. It uses **points only**: no real money, deposits, prizes, or cash-out.

## Run it on your computer

1. Install Node.js 18 or newer from https://nodejs.org/
2. Unzip this folder.
3. Open a terminal in this folder and run:

   ```bash
   npm install
   npm start
   ```

4. Open http://localhost:3000

To let friends on the same Wi-Fi test it, they can visit your computer's local network address on port 3000. For friends outside your home, deploy it publicly as described below.

## Put it online so friends can join from anywhere

A straightforward option is Render:

1. Create a GitHub account if you don't already have one.
2. Create a new GitHub repository and upload the contents of this folder.
3. Sign in to https://render.com and choose **New → Web Service**.
4. Connect your GitHub repository.
5. Use these settings:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: a plan that supports your intended use
6. Deploy. Render will give you a public `https://...onrender.com` address.
7. Share that address with friends. One person creates a room; everyone else joins with the room code or invite link.

Keep the server running while playing. Room state is held in memory, so restarting/redeploying the server ends active rooms. This starter version does not include accounts or persistent leaderboards.

## Game notes

- Texas Hold'em, 2–6 players per room.
- Each player starts with 1,000 free points.
- Small blind: 5 points; big blind: 10 points.
- Private hole cards, shared community cards, fold/check/call/raise actions.
- Room host can deal the next hand after a showdown.
- No real-money functionality.
