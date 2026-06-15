import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

beforeEach(() => {
  require('./helpers/reset').resetTestEnvironment();
});

test('schema project helpers build and resolve projects', async () => {
  const vscode = require('./helpers/vscode-mock').vscode;
  const schemaProject = require('../out/schemaProject');
  const root = '/workspace/rails-app';
  const structureUri = vscode.Uri.file(`${root}/db/structure.sql`);
  const schemaUri = vscode.Uri.file(`${root}/db/schema.rb`);

  assert.equal(schemaProject.projectRootFromSchemaUri(structureUri), root);
  assert.equal(schemaProject.projectNameFromRoot(root), 'rails-app');
  assert.equal(schemaProject.projectIdFromRoot(root), root);

  const projects = schemaProject.buildProjectsFromSchemaUris([structureUri], [schemaUri]);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].schemaKind, 'structure.sql');

  const onlyRb = schemaProject.buildProjectsFromSchemaUris([], [schemaUri]);
  assert.equal(onlyRb[0].schemaKind, 'schema.rb');

  const resolved = schemaProject.resolveProjectForFile(`${root}/app/models/user.rb`, projects);
  assert.equal(resolved?.id, root);
  assert.equal(schemaProject.resolveProjectForFile(undefined, projects), undefined);
  assert.equal(schemaProject.resolveProjectById(root, projects)?.name, 'rails-app');
  assert.equal(schemaProject.resolveProjectById('missing', projects), undefined);

  const best = schemaProject.pickBestProject(projects, `${root}/app/models/user.rb`);
  assert.equal(best?.id, root);
  assert.equal(schemaProject.pickBestProject([], 'x'), undefined);
  assert.equal(schemaProject.pickBestProject([projects[0]], `${root}/app/models/user.rb`)?.id, root);

  const multi = [
    ...projects,
    {
      id: '/workspace/other',
      name: 'other',
      rootPath: '/workspace/other',
      schemaUri: vscode.Uri.file('/workspace/other/db/schema.rb'),
      schemaKind: 'schema.rb',
    },
  ];
  assert.ok(schemaProject.pickBestProject(multi, `${root}/app/models/user.rb`));

  const summaries = schemaProject.summarizeProjects(projects);
  assert.equal(summaries[0].id, root);
  assert.equal(schemaProject.projectLabel(projects[0]), 'rails-app');
});

test('discoverSchemaProjects uses workspace findFiles', async () => {
  const { seedRailsProject } = require('./helpers/reset');
  seedRailsProject();
  const { discoverSchemaProjects } = require('../out/schemaProject');
  const projects = await discoverSchemaProjects();
  assert.equal(projects.length, 1);
});
