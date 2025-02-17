import { Octokit, RestEndpointMethodTypes } from '@octokit/rest'
import { globby } from 'globby' 
import path from 'path'
import { readFile } from 'fs-extra'

const main = async () => {
  // There are other ways to authenticate, check https://developer.github.com/v3/#authentication
  const octo = new Octokit({
    auth: process.env.GITHUB_ACCESS_TOKEN,
  })
  // For this, I was working on a organization repos, but it works for common repos also (replace org for owner)
  const ORGANIZATION = `k2on`
  const REPO = `my-test-repo`
  const repos = await octo.repos.listForAuthenticatedUser({
    // org: ORGANIZATION,
  })
  if (repos.data.some(r => r.name == REPO)) {
    await createRepo(octo, REPO)
  }
  /**
   * my-local-folder has files on its root, and subdirectories with files
   */
  await uploadToRepo(octo, `./my-local-folder`, ORGANIZATION, REPO)
}

main()

const createRepo = async (octo: Octokit, name: string) => {
  await octo.repos.createForAuthenticatedUser({ name, auto_init: true })
}

const uploadToRepo = async (
  octo: Octokit,
  coursePath: string,
  org: string,
  repo: string,
  branch: string = `main`
) => {
  // gets commit's AND its tree's SHA
  const currentCommit = await getCurrentCommit(octo, org, repo, branch)
  const filesPaths = await globby(coursePath)
  const filesBlobs = await Promise.all(filesPaths.map(createBlobForFile(octo, org, repo)))
  const pathsForBlobs = filesPaths.map(fullPath => path.relative(coursePath, fullPath))
  const newTree = await createNewTree(
    octo,
    org,
    repo,
    filesBlobs,
    pathsForBlobs,
    currentCommit.treeSha
  )
  const commitMessage = `My commit message`
  const newCommit = await createNewCommit(
    octo,
    org,
    repo,
    commitMessage,
    newTree.sha,
    currentCommit.commitSha
  )
  await setBranchToCommit(octo, org, repo, branch, newCommit.sha)
}


const getCurrentCommit = async (
  octo: Octokit,
  org: string,
  repo: string,
  branch: string = 'main'
) => {
  const { data: refData } = await octo.git.getRef({
    owner: org,
    repo,
    ref: `heads/${branch}`,
  })
  const commitSha = refData.object.sha
  const { data: commitData } = await octo.git.getCommit({
    owner: org,
    repo,
    commit_sha: commitSha,
  })
  return {
    commitSha,
    treeSha: commitData.tree.sha,
  }
}

// Notice that readFile's utf8 is typed differently from Github's utf-8
const getFileAsUTF8 = (filePath: string) => readFile(filePath, 'utf8')

const createBlobForFile = (octo: Octokit, org: string, repo: string) => async (
  filePath: string
) => {
  const content = await getFileAsUTF8(filePath)
  const blobData = await octo.git.createBlob({
    owner: org,
    repo,
    content,
    encoding: 'utf-8',
  })
  return blobData.data
}

interface GitCreateBlobResponse {
  url: string;
  sha: string;
}

interface GitCreateTreeParamsTree {
  path?: string | undefined;
  mode?: "100644" | "100755" | "040000" | "160000" | "120000" | undefined;
  type?: "tree" | "blob" | "commit" | undefined;
  sha?: string | undefined;
  content?: string | undefined;
}

const createNewTree = async (
  octo: Octokit,
  owner: string,
  repo: string,
  blobs: GitCreateBlobResponse[],
  paths: string[],
  parentTreeSha: string
) => {
  // My custom config. Could be taken as parameters
  const tree = blobs.map(({ sha }, index) => ({
    path: paths[index],
    mode: `100644`,
    type: `blob`,
    sha,
  })) as GitCreateTreeParamsTree[]
  const { data } = await octo.git.createTree({
    owner,
    repo,
    tree,
    base_tree: parentTreeSha,
  })
  return data
}

const createNewCommit = async (
  octo: Octokit,
  org: string,
  repo: string,
  message: string,
  currentTreeSha: string,
  currentCommitSha: string
) =>
  (await octo.git.createCommit({
    owner: org,
    repo,
    message,
    tree: currentTreeSha,
    parents: [currentCommitSha],
  })).data

const setBranchToCommit = (
  octo: Octokit,
  org: string,
  repo: string,
  branch: string = `main`,
  commitSha: string
) =>
  octo.git.updateRef({
    owner: org,
    repo,
    ref: `heads/${branch}`,
    sha: commitSha,
  })

