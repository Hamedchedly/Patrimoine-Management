FROM node:22-alpine AS build
WORKDIR /app

# Dépendances (npm, lockfile package-lock.json)
COPY package.json package-lock.json ./
RUN npm ci

# Sources + build (TanStack Start + Nitro -> .output/)
# Railway n'injecte les variables dans un build Dockerfile QUE si elles sont
# déclarées via ARG. Sans elles au moment du build, Vite ne peut pas inliner
# VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY dans le bundle client.
# Uniquement ces deux variables (publiques) sont exposées au build ; les
# variables SUPABASE_* / EXT_* restent exclusivement au runtime.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

COPY . .
RUN npm run build

# Image runtime
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Nitro (preset node-server) génère un serveur autonome dans .output
COPY --from=build /app/.output ./.output

EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
