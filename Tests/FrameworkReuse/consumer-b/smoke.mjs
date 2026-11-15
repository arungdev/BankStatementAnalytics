import * as core from '@common/client/core';
import * as ui from '@common/client';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { check } from '../check.mjs';
await check({ core, ui, React, renderToStaticMarkup, namespace: 'beta', baseURL: 'https://beta.example.test/v2', loginPath: '/session/new' });
