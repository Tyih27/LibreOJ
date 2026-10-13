// This file is generated automatically, do NOT modify it.

/// <reference path="../types.d.ts" />

import { createGetApi, createPostApi } from "@/api";

export const createHack = createPostApi<ApiTypes.CreateHackRequestDto, ApiTypes.CreateHackResponseDto>(
  "hack/createHack",
  false
);
export const queryHacks = createPostApi<ApiTypes.QueryHacksRequestDto, ApiTypes.QueryHacksResponseDto>(
  "hack/queryHacks",
  false
);
export const getHack = createPostApi<ApiTypes.GetHackRequestDto, ApiTypes.GetHackResponseDto>("hack/getHack", false);
