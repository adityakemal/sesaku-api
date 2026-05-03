FROM oven/bun:1

WORKDIR /app

# Copy package.json untuk layer caching
COPY package.json ./

# Install dependencies tanpa bergantung pada lockfile
RUN bun install --no-save

# Copy seluruh source code backend
COPY . .

# Expose port yang digunakan Elysia (default 3001)
EXPOSE 3001

# Jalankan server
CMD ["bun", "run", "start"]
