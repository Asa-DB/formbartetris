## Formbar Tetris

Small Express app that protects a Tetris “arcade cabinet” behind Formbar login and a Digipog entry fee.

### Clone

```bash
git clone https://github.com/<your-org-or-user>/formbartetris.git
cd formbartetris
```

### Install

You need **Node.js 18+** and **npm**.

```bash
npm install
```

Then create your environment file by copying the template:

```bash
cp .env_template .env   # on Windows PowerShell: copy .env_template .env
```

Edit `.env` and set the values for your deployment. The important ones are:

- **PORT**: Port the Express server listens on (e.g. `3000`).
- **FORMBAR_URL**: Base URL of your Formbar instance (e.g. `https://formbar.yourdomain.com`).
- **THIS_URL**: Public URL for this app (e.g. `https://localhost:3000` while developing).
- **PAYUSER**: Formbar user ID that will receive Digipog payments.
- **ENTRYFEE**: How many Digipogs it costs to play.
- **SECRET**: Session/JWT secret; set this to a long random string.

### Run

Development / local run:

```bash
node app.js
```

The server will start on the `PORT` configured in your `.env` (default from the template is `3000`) and log the URL it is serving on.

### Play

1. Open your browser to `THIS_URL` (e.g. `https://localhost:3000`).
2. You’ll be redirected to **Formbar** to log in.
3. After login you land on the entry form where you confirm payment (Digipogs) for a game.
4. On successful payment you are redirected to the **Tetris – Waifu Edition** page.
5. Controls (in the Tetris screen):
   - **Arrow keys**: Move / rotate / soft drop.
   - **Space**: Hard drop.
   - **C**: Hold piece.
   - **P**: Pause / resume.

Static assets (Tetris, GIFs, music) live in the `public` folder and are served automatically by Express.
