FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PNPM_STORE_DIR=/pnpm/store
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable \
  && pnpm config set store-dir "${PNPM_STORE_DIR}"

FROM base AS dev

WORKDIR /workspace/document-parser

FROM base AS build-deps

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/orchestrator-api/package.json ./apps/orchestrator-api/package.json
COPY apps/document-processing-worker/package.json ./apps/document-processing-worker/package.json
COPY packages/shared-kernel/package.json ./packages/shared-kernel/package.json
COPY packages/document-processing-domain/package.json ./packages/document-processing-domain/package.json
COPY packages/testkit/package.json ./packages/testkit/package.json

RUN pnpm install --frozen-lockfile

FROM build-deps AS build

COPY apps ./apps
COPY packages ./packages

RUN pnpm build

FROM base AS prod-deps

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/orchestrator-api/package.json ./apps/orchestrator-api/package.json
COPY apps/document-processing-worker/package.json ./apps/document-processing-worker/package.json
COPY packages/shared-kernel/package.json ./packages/shared-kernel/package.json
COPY packages/document-processing-domain/package.json ./packages/document-processing-domain/package.json
COPY packages/testkit/package.json ./packages/testkit/package.json

RUN pnpm install --prod --frozen-lockfile

FROM node:22-bookworm-slim AS prod

ENV NODE_ENV=production

WORKDIR /app

COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/orchestrator-api/package.json ./apps/orchestrator-api/package.json
COPY --from=prod-deps /app/apps/document-processing-worker/package.json ./apps/document-processing-worker/package.json
COPY --from=prod-deps /app/packages/shared-kernel/package.json ./packages/shared-kernel/package.json
COPY --from=prod-deps /app/packages/document-processing-domain/package.json ./packages/document-processing-domain/package.json
COPY --from=build /app/apps/orchestrator-api/dist ./apps/orchestrator-api/dist
COPY --from=build /app/apps/document-processing-worker/dist ./apps/document-processing-worker/dist
COPY --from=build /app/packages/shared-kernel/dist ./packages/shared-kernel/dist
COPY --from=build /app/packages/document-processing-domain/dist ./packages/document-processing-domain/dist
COPY tooling/scripts/docker-entrypoint.cjs ./tooling/scripts/docker-entrypoint.cjs

ENTRYPOINT ["node", "tooling/scripts/docker-entrypoint.cjs"]
CMD ["api"]
