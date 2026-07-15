const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP_UTF8_FLAG = 0x0800

const encoder = new TextEncoder()

const fillWithZero = function (num) {
  return `${num < 10 ? "0" : ""}${num}`
}

const formatDate = function (dateString, showSecond = true) {
  const date = new Date(dateString)
  return [
    date.getFullYear(),
    fillWithZero(date.getMonth() + 1),
    fillWithZero(date.getDate()),
  ].join("-") +
    " " +
    [
      fillWithZero(date.getHours()),
      fillWithZero(date.getMinutes()),
      showSecond ? fillWithZero(date.getSeconds()) : null,
    ]
      .filter(Boolean)
      .join(":")
}

const sanitizeFileName = function (value) {
  return (value || "speechless-export")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
}

const stripHtml = function (html) {
  if (!html) {
    return ""
  }
  const div = document.createElement("div")
  div.innerHTML = html
  return div.textContent || div.innerText || ""
}

const normalizeText = function (value) {
  return stripHtml(value)
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const escapeMarkdown = function (value) {
  return (value || "").replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1")
}

const extractPostImages = function (post) {
  if (!post?.pic_infos) {
    return []
  }

  return Object.keys(post.pic_infos).map((key, index) => {
    const imageInfo = post.pic_infos[key]
    const target =
      imageInfo?.largest ||
      imageInfo?.large ||
      imageInfo?.mw2000 ||
      imageInfo?.original ||
      imageInfo?.bmiddle ||
      imageInfo?.thumbnail

    return {
      url: target?.url || imageInfo?.large?.url || "",
      extension: getImageExtension(target?.url || imageInfo?.large?.url || ""),
      width: target?.width || imageInfo?.large?.width || 0,
      height: target?.height || imageInfo?.large?.height || 0,
      index,
    }
  })
}

const getImageExtension = function (url) {
  if (!url) {
    return "jpg"
  }

  try {
    const pathname = new URL(url).pathname
    const matched = pathname.match(/\.([a-zA-Z0-9]+)$/)
    return matched ? matched[1].toLowerCase() : "jpg"
  } catch (error) {
    return "jpg"
  }
}

const fetchImageAsUint8Array = async function (url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  return new Uint8Array(arrayBuffer)
}

const downloadImages = async function (posts) {
  const imageEntries = []

  for (let postIndex = 0; postIndex < posts.length; postIndex++) {
    const post = posts[postIndex]
    const images = extractPostImages(post)

    for (const image of images) {
      const basename = `post-${fillWithZero(postIndex + 1)}-${fillWithZero(
        image.index + 1
      )}.${image.extension}`
      const path = `images/${basename}`

      try {
        const bytes = await fetchImageAsUint8Array(image.url)
        imageEntries.push({
          postId: post.idstr || `${postIndex}`,
          originalUrl: image.url,
          path,
          bytes,
        })
      } catch (error) {
        console.error("Failed to download image", image.url, error)
        imageEntries.push({
          postId: post.idstr || `${postIndex}`,
          originalUrl: image.url,
          path: image.url,
          bytes: null,
        })
      }
    }
  }

  return imageEntries
}

const getImageRefsByPostId = function (imageEntries) {
  const map = new Map()
  for (const entry of imageEntries) {
    if (!map.has(entry.postId)) {
      map.set(entry.postId, [])
    }
    map.get(entry.postId).push(entry)
  }
  return map
}

const buildMarkdown = function ({ posts, username, imageEntries }) {
  const lines = [
    `# @${escapeMarkdown(username)}`,
    "",
    `导出时间：${formatDate(new Date().toISOString())}`,
    `微博数量：${posts.length}`,
    "",
    "---",
    "",
  ]

  const imageMap = getImageRefsByPostId(imageEntries)

  posts.forEach((post, index) => {
    const postLines = []
    postLines.push(`## ${index + 1}. ${formatDate(post.created_at)}`)

    if (post.region_name) {
      postLines.push("")
      postLines.push(`位置：${normalizeText(post.region_name.replace("发布于 ", ""))}`)
    }

    const mainText = normalizeText(
      post.long_text_source || post.text || post.page_info?.page_title || ""
    )
    if (mainText) {
      postLines.push("")
      postLines.push(mainText)
    }

    if (post.retweeted_status?.user) {
      const retweetText = normalizeText(
        post.retweeted_status.long_text_source || post.retweeted_status.text || ""
      )
      postLines.push("")
      postLines.push(
        `> 转发 @${post.retweeted_status.user.screen_name || ""}${
          retweetText ? `：${retweetText.replace(/\n/g, "\n> ")}` : ""
        }`
      )
    }

    const postImages = imageMap.get(post.idstr || `${index}`) || []
    if (postImages.length > 0) {
      postLines.push("")
      postImages.forEach((image, imageIndex) => {
        const alt = `微博图片 ${imageIndex + 1}`
        postLines.push(`![${alt}](${encodeURI(image.path)})`)
      })
    }

    lines.push(...postLines, "", "---", "")
  })

  return lines.join("\n")
}

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

const crc32 = function (input) {
  let crc = 0xffffffff
  for (let i = 0; i < input.length; i++) {
    crc = crcTable[(crc ^ input[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const dateToDosTime = function (date) {
  const safeYear = Math.max(date.getFullYear(), 1980)
  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2),
    date:
      ((safeYear - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate(),
  }
}

const concatUint8Arrays = function (arrays) {
  const total = arrays.reduce((sum, item) => sum + item.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  arrays.forEach((item) => {
    result.set(item, offset)
    offset += item.length
  })
  return result
}

const createZipBlob = function (files) {
  const localParts = []
  const centralParts = []
  let offset = 0
  const now = new Date()
  const dos = dateToDosTime(now)

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.path)
    const data = file.bytes
    const crc = crc32(data)

    const localHeader = new ArrayBuffer(30)
    const localView = new DataView(localHeader)
    localView.setUint32(0, ZIP_LOCAL_FILE_HEADER_SIGNATURE, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, ZIP_UTF8_FLAG, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, dos.time, true)
    localView.setUint16(12, dos.date, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, data.length, true)
    localView.setUint32(22, data.length, true)
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true)

    const localChunk = concatUint8Arrays([
      new Uint8Array(localHeader),
      nameBytes,
      data,
    ])
    localParts.push(localChunk)

    const centralHeader = new ArrayBuffer(46)
    const centralView = new DataView(centralHeader)
    centralView.setUint32(0, ZIP_CENTRAL_DIRECTORY_SIGNATURE, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, ZIP_UTF8_FLAG, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, dos.time, true)
    centralView.setUint16(14, dos.date, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, data.length, true)
    centralView.setUint32(24, data.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, offset, true)

    const centralChunk = concatUint8Arrays([
      new Uint8Array(centralHeader),
      nameBytes,
    ])
    centralParts.push(centralChunk)
    offset += localChunk.length
  })

  const centralDirectory = concatUint8Arrays(centralParts)
  const endHeader = new ArrayBuffer(22)
  const endView = new DataView(endHeader)
  endView.setUint32(0, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, true)
  endView.setUint16(4, 0, true)
  endView.setUint16(6, 0, true)
  endView.setUint16(8, files.length, true)
  endView.setUint16(10, files.length, true)
  endView.setUint32(12, centralDirectory.length, true)
  endView.setUint32(16, offset, true)
  endView.setUint16(20, 0, true)

  return new Blob(
    [...localParts, centralDirectory, new Uint8Array(endHeader)],
    { type: "application/zip" }
  )
}

const downloadBlob = function (blob, fileName) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1000)
}

export const exportMarkdownPackage = async function ({
  posts,
  username,
  fileBase,
}) {
  const safeBase = sanitizeFileName(fileBase || `@${username}`)
  const imageEntries = await downloadImages(posts)
  const markdown = buildMarkdown({
    posts,
    username,
    imageEntries,
  })

  const files = [
    {
      path: `${safeBase}.md`,
      bytes: encoder.encode(markdown),
    },
  ]

  imageEntries.forEach((entry) => {
    if (entry.bytes) {
      files.push({
        path: entry.path,
        bytes: entry.bytes,
      })
    }
  })

  const zipBlob = createZipBlob(files)
  downloadBlob(zipBlob, `${safeBase}.zip`)
}
