# Deploy POL263 on InterServer VPS

Follow these steps on your InterServer VPS to run the app 24/7.

---

## What you need from InterServer

After buying the VPS you should have received an email with:

- **IP address** (e.g. `123.45.67.89`)
- **Root password** (or SSH key)
- **Username** (often `root`)

Keep these handy.

---

## Step 1: Connect to your VPS

### If SSH keeps saying "Permission denied" — use the Web Console instead

You don’t need SSH to deploy. Use the **browser-based console**:

1. In **my.interserver.net** go to **VPS** → click your server (**vps3303787**).
2. On the VPS page, find and click **"Setup VNC"**, **"Web Console"**, **"Console"**, **"VNC"**, or **"Launch console"** (wording may vary).
3. A new tab or window opens with a black terminal screen and a **login prompt** (e.g. `vps3303787 login:`).
4. Type **root** and press Enter.
5. When it asks for **Password:** type your (new) root password and press Enter. You may still see nothing as you type — that’s normal.
6. When you see a prompt like `root@vps3303787:~#`, you’re in. You can run **all the commands from Step 2 onward** in this browser console. Copy-paste works here.

After you’re in, continue from **Step 2** below. To fix SSH later, open an InterServer support ticket and ask: *"SSH as root gives Permission denied even after resetting the root password. Please enable password authentication for root or provide the correct SSH login method."*

### SSH password on Windows (important)

When SSH asks for the password:

- **Nothing will appear as you type** — no dots, no asterisks, no letters. This is normal. The terminal is still reading your keystrokes.
- **Type the password once, carefully**, then press **Enter**. Do not wait for any characters to show.
- **Paste often doesn’t work** in PowerShell or Command Prompt for password fields. If Ctrl+V does nothing, you must **type the password by hand**. If it’s long, type it in Notepad first so you can see it, then type the same into the terminal (still nothing will show — that’s OK).
- If you get “Access denied” or “Permission denied”, the password was wrong. Try again: run `ssh root@YOUR_VPS_IP` again and type the password one more time (again, no characters will show).

### On Windows (PowerShell or Command Prompt)

**If you get "Permission denied" even with the right password:** Try (1) Use the exact username shown in the InterServer VPS page (often `root`). (2) In the panel, use **Reset root password** and set a simple new password (letters and numbers only), then type it by hand. (3) Use the **Web console / VNC / Console** link in the VPS page to log in in the browser instead of SSH—you can run all deployment commands there. (4) Open an InterServer support ticket and ask them to confirm the SSH username and password or reset it.

1. Open **PowerShell** or **Command Prompt**.
2. Run (replace with your VPS IP and username):

   ```bash
   ssh root@YOUR_VPS_IP
   ```

3. When it asks "Are you sure you want to continue connecting?", type **yes** and press Enter.
4. Enter the **root password** when asked (you won’t see it as you type).

You should see a prompt like `root@vps:~#`. You’re now on the server.

### On Mac/Linux

Open **Terminal** and run the same command:

```bash
ssh root@YOUR_VPS_IP
```

---

## Step 2: Install Node.js, PostgreSQL, and Git

Copy and paste these commands **one block at a time** (after each block, wait for it to finish).

**Update the system (Ubuntu/Debian):**

```bash
apt update && apt upgrade -y
```

**Install Node.js 20:**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

**Install PostgreSQL (choose one):**

- **Automatic:** Run the setup script **after** you have cloned the app to the VPS (Step 4). Then you can skip **Step 3** and use the same password in `.env` in Step 5. See **“Optional: automatic PostgreSQL setup”** after Step 4.
- **Manual (do it now):** Run:

  ```bash
  apt install -y postgresql postgresql-contrib
  ```

  Then do **Step 3** to create the database and set the password.

**Install Git:**

```bash
apt install -y git
```

**Check versions (optional):**

```bash
node -v
npm -v
psql --version
```

You should see version numbers. That’s enough to continue.

---

## Step 3: Create the database

Run these on the VPS:

```bash
sudo -u postgres psql -c "CREATE DATABASE pol263;"
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'CHOOSE_A_STRONG_PASSWORD';"
```

Replace `CHOOSE_A_STRONG_PASSWORD` with a real password (e.g. a long random string). You’ll use it in the next step.

---

## Step 4: Put your app on the VPS

You have two options.

### Option A: Clone from GitHub (recommended)

1. **On your own PC** (in Cursor/your project folder): push your project to GitHub if you haven’t already.
   - Create a repo at [github.com/new](https://github.com/new).
   - Then in your project folder:
     ```bash
     git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
     git push -u origin main
     ```

2. **On the VPS**, run (replace with your repo URL):

   ```bash
   cd /opt
   git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git pol263
   cd pol263
   ```

### Option B: Upload with SCP (if you don’t use GitHub)

**On your Windows PC** (in PowerShell, in your project folder, e.g. `POL263`):

```powershell
scp -r . root@YOUR_VPS_IP:/opt/pol263
```

Then on the VPS:

```bash
cd /opt/pol263
```

### Optional: automatic PostgreSQL setup

If you skipped installing PostgreSQL in Step 2 or want to set the database up in one go:

1. Make sure you’re in the app folder: `cd /opt/pol263`
2. Run (replace `YourSecurePassword123` with the password you want for the database):

   ```bash
   chmod +x script/setup-postgres-vps.sh
   sudo CHIBIKHULU_DB_PASSWORD='YourSecurePassword123' ./script/setup-postgres-vps.sh
   ```

3. Use that **same password** in Step 5 for `YOUR_POSTGRES_PASSWORD` in `.env` (and in `DATABASE_URL`).

If you use this, you can skip **Step 3** (Create the database). If you haven’t installed PostgreSQL at all yet, run first: `apt install -y postgresql postgresql-contrib`, then the script above.

---

## Step 5: Configure environment variables

On the VPS:

```bash
cd /opt/pol263
nano .env
```

In the editor:

1. Paste the lines below.
2. Replace `YOUR_POSTGRES_PASSWORD` with the password you set in Step 3.
3. Replace `your-random-session-secret-here` with a long random string (e.g. 32+ characters).

```env
NODE_ENV=production
PORT=5000
HOST=0.0.0.0
DATABASE_URL=postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/pol263
SESSION_SECRET=your-random-session-secret-here
```

Save and exit: **Ctrl+O**, Enter, then **Ctrl+X**.

---

## Step 6: Build and set up the database

On the VPS:

```bash
cd /opt/pol263
npm install
npm run build
npm run db:setup
```

If `db:setup` asks to apply changes, type **y** and press Enter.

---

## Step 7: Run the app with PM2 (keeps it running)

**Install PM2:**

```bash
npm install -g pm2
```

**Start the app:**

```bash
cd /opt/pol263
pm2 start dist/index.cjs --name pol263 --node-args="--env-file=.env"
```

Or if the above fails, try:

```bash
pm2 start npm --name pol263 -- start
```

**Make it start on reboot:**

```bash
pm2 startup
pm2 save
```

(If `pm2 startup` prints a command, run that command as shown.)

**Check status:**

```bash
pm2 status
pm2 logs pol263
```

Press **Ctrl+C** to stop viewing logs. The app keeps running.

---

## Step 8: Open the app in your browser

1. On the VPS, open the firewall for port 5000:

   ```bash
   ufw allow 5000
   ufw enable
   ```

   Type **y** when asked to enable the firewall.

2. In your browser go to:

   **http://YOUR_VPS_IP:5000**

   Replace `YOUR_VPS_IP` with the VPS IP from InterServer.

You should see the POL263 landing page.

---

## Optional: Use port 80 (no :5000 in the URL)

So the site works at **http://YOUR_VPS_IP** (port 80):

**Install Nginx:**

```bash
apt install -y nginx
```

**Create a config:**

```bash
nano /etc/nginx/sites-available/pol263
```

Paste this (replace `YOUR_VPS_IP` if you want to use a domain later):

```nginx
server {
    listen 80;
    server_name YOUR_VPS_IP;
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Save and exit (Ctrl+O, Enter, Ctrl+X). Then:

```bash
ln -s /etc/nginx/sites-available/pol263 /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
ufw allow 80
```

Open **http://YOUR_VPS_IP** in your browser (no `:5000`).

---

## Quick reference

| Task              | Command |
|-------------------|--------|
| See app status    | `pm2 status` |
| View logs         | `pm2 logs pol263` |
| Restart app       | `pm2 restart pol263` |
| Stop app          | `pm2 stop pol263` |
| Start app         | `pm2 start pol263` |

---

## If something goes wrong

- **"Connection refused" in browser**  
  - Check: `pm2 status` shows `pol263` as **online**.  
  - Check: `ufw allow 5000` (and `ufw allow 80` if using Nginx).

- **"DATABASE_URL must be set" or DB errors**  
  - Check `.env` exists in `/opt/pol263` and has the correct `DATABASE_URL` and password.  
  - Run again: `npm run db:setup`.

- **App crashes**  
  - Run `pm2 logs pol263` and read the last lines for the error.  
  - Fix the cause (e.g. wrong `.env`), then `pm2 restart pol263`.

- **Updates from your PC**  
  - Push to GitHub, then on the VPS:  
    `cd /opt/pol263 && git pull && npm install && npm run build && pm2 restart pol263`

---

## Summary

1. SSH into the VPS.
2. Install Node.js 20, PostgreSQL, Git.
3. Create database `pol263` and set postgres password.
4. Clone or upload the app to `/opt/pol263`.
5. Create `.env` with `DATABASE_URL`, `SESSION_SECRET`, `PORT`, `HOST`.
6. Run `npm install`, `npm run build`, `npm run db:setup`.
7. Start with PM2 and enable startup.
8. Open **http://YOUR_VPS_IP:5000** (or set up Nginx and use port 80).

After this, your POL263 app will be running on your InterServer VPS.
