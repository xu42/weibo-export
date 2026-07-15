import axios from "axios"

const GetPostsByRangeApiURL = `https://weibo.com/ajax/statuses/searchProfile`
const GetLongTextURL = `https://weibo.com/ajax/statuses/longtext`

let page = 1
let total = 0
let count = 0
let loadMore = true
let _uid
let _sourceType = 1
let speechlessListEL

let _callback

// 拉取间隔时间
let interval = 1000

// 上一次拉取时间
let lastFetchTimeStamp = 0

const delay = function (timeout) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout)
  })
}

const resetState = function () {
  page = 1
  total = 0
  count = 0
  loadMore = true
  _uid = ""
  _sourceType = 1
  speechlessListEL = null
  lastFetchTimeStamp = 0
}

const updateWholePageState = function () {
  count++
  _callback({
    type: "count",
    value: count,
  })
}

const generateHTML = function () {
  const sourceRoot = document.getElementById("app")
  if (sourceRoot) {
    sourceRoot.remove()
  }

  const existedList = document.querySelector(".speechless-list")
  if (existedList) {
    existedList.remove()
  }

  speechlessListEL = document.createElement("div")
  speechlessListEL.classList = "speechless-list speechless-list-small"
  document.body.append(speechlessListEL)
}

const getDate = function (dateString, showSecond) {
  let date = new Date(dateString)
  let hour = date.getHours()
  let minute = date.getMinutes()
  let second = date.getSeconds()
  let year = date.getFullYear()
  let month = date.getMonth() + 1
  let day = date.getDate()

  let fillWithZero = function (num) {
    if (parseInt(num) < 10) {
      return "0" + num.toString()
    } else return num.toString()
  }
  return (
    year +
    "/" +
    fillWithZero(month) +
    "/" +
    fillWithZero(day) +
    " " +
    fillWithZero(hour) +
    ":" +
    fillWithZero(minute) +
    (showSecond ? ":" + fillWithZero(second) : "")
  )
}

const clearLineBreak = function (text = "") {
  let textClear = text.replace(/\n/g, "<br/>")
  textClear = textClear.replace(/(<br\s?\/>){3,}/g, "<br/><br/>")
  return textClear
}

const combineImageHtml = function (image, size) {
  let str
  if (!size) size = 120

  if (image.width > 0 && image.height > 0) {
    str = `<div class="image-container" style="width:${
      (image.width * size) / image.height
    }px;flex-grow:${
      (image.width * size) / image.height
    }"><i class="image-placeholder" style="padding-bottom:${
      (image.height / image.width) * 100
    }%"></i><img class="image-new" src="${image.url}" /></div>`
  } else {
    str = `<img class="image-old" style="height:${size}px" src="${image.url}" />`
  }

  return str
}

const shouldKeepPost = function (post) {
  if (post.user.id != _uid) {
    return false
  }

  if (_sourceType == 1 && post.retweeted_status) {
    return false
  }

  return true
}

const appendPostToBody = function (post) {
  let metaHTML = ""

  metaHTML += `<div class="meta">
                <div class="meta-info">
                    <span class="date">${getDate(post.created_at)}</span>`
  if (post.region_name) {
    metaHTML += `<div class="region">${post.region_name.replace(
      "发布于 ",
      ""
    )}</div>`
  }
  metaHTML += `</div></div>`

  let textHTML = `<div class="text">${clearLineBreak(
    post.long_text_source || post.text || post.page_info?.page_title || ""
  )}</div>`

  let retweetHTML = ""
  if (post.retweeted_status && post.retweeted_status.user) {
    retweetHTML += `<div class="retweet">`
    retweetHTML += `${
      post.retweeted_status.user.screen_name
        ? post.retweeted_status.user.screen_name
        : ""
    }<span style="margin:0 3px;">:</span>${clearLineBreak(
      post.retweeted_status.long_text_source || post.retweeted_status.text || ""
    )}`
    retweetHTML += `</div>`
  }

  let mediaHTML = ""

  if (post.pic_infos) {
    mediaHTML += '<div class="media media-small">'
    for (let key in post.pic_infos) {
      mediaHTML += combineImageHtml(post.pic_infos[key].large, 160)
    }
    mediaHTML += "</div>"

    mediaHTML += '<div class="media media-medium">'
    for (let key in post.pic_infos) {
      mediaHTML += combineImageHtml(post.pic_infos[key].large, 320)
    }
    mediaHTML += "</div>"

    mediaHTML += '<div class="media media-large">'
    for (let key in post.pic_infos) {
      mediaHTML += combineImageHtml(post.pic_infos[key].large, 500)
    }
    mediaHTML += "</div>"
  }

  let postHTML = `
        ${metaHTML}
        <div class="main">
        ${textHTML}
        ${retweetHTML}
        ${mediaHTML}            
        </div>`

  let node = document.createElement("div")
  node.className = "speechless-post"
  node.innerHTML = postHTML

  speechlessListEL.appendChild(node)
}

const renderPosts = function (posts) {
  posts.forEach((post) => {
    appendPostToBody(post)
    updateWholePageState()
  })
  window.scrollTo(0, document.body.scrollHeight)
}

const fetchWithRetry = async function (apiURL, parameters, retries = 3) {
  while (retries > 0) {
    try {
      const response = await axios.get(apiURL, parameters)
      return response
    } catch (error) {
      console.error(`Fetch failed, ${retries - 1} retries left: `, error)
      retries--
    }
  }
  throw new Error("Maximum retries reached, request failed")
}

const doFetch = async function (parameters) {
  if (!parameters) parameters = {}

  let offset = parseInt(new Date().valueOf()) - lastFetchTimeStamp
  if (offset < interval) {
    let delayMS = interval - offset
    console.log(`Delay of ${delayMS} milliseconds`)
    await delay(delayMS)
  }

  lastFetchTimeStamp = parseInt(new Date().getTime())
  const fetchResp = await fetchWithRetry(GetPostsByRangeApiURL, {
    params: parameters,
  })

  try {
    let resp = fetchResp.data.data
    _callback({
      type: "total",
      value: resp.total,
    })
    return resp
  } catch (err) {
    console.error(err)
    return
  }
}

const formatPosts = async function (posts, uid) {
  let list = []

  for (let post of posts) {
    if (post.user.id != uid) continue

    if (!!post.isLongText) {
      try {
        let offset = parseInt(new Date().valueOf()) - lastFetchTimeStamp
        if (offset < interval) {
          let delayMS = interval - offset
          console.log(`Delay of ${delayMS} milliseconds`)
          await delay(delayMS)
        }
        lastFetchTimeStamp = parseInt(new Date().getTime())
        let longtextData = await fetchLongText(post.mblogid)
        post.long_text_source = longtextData.longTextContent || ""
      } catch (err) {
        console.error(err)
      }
    }

    if (post.retweeted_status && post.retweeted_status.isLongText) {
      try {
        let offset = parseInt(new Date().valueOf()) - lastFetchTimeStamp
        if (offset < interval) {
          let delayMS = interval - offset
          console.log(`Delay of ${delayMS} milliseconds`)
          await delay(delayMS)
        }
        lastFetchTimeStamp = parseInt(new Date().getTime())
        let longtextData = await fetchLongText(post.retweeted_status.mblogid)
        post.retweeted_status.long_text_source =
          longtextData.longTextContent || ""
      } catch (err) {
        console.error(err)
      }
    }

    if (shouldKeepPost(post)) {
      list.push(post)
    }
  }

  return list
}

const sortPosts = function (posts, sortType) {
  return [...posts].sort((a, b) => {
    const timeA = new Date(a.created_at).getTime()
    const timeB = new Date(b.created_at).getTime()
    return sortType == 1 ? timeA - timeB : timeB - timeA
  })
}

function getLastDayTimestamp(obj) {
  let { year, month } = obj
  const nextMonth = parseInt(month) + 1
  const nextMonthFirstDay = new Date(year, nextMonth - 1, 1)
  nextMonthFirstDay.setHours(0, 0, 0, 0)
  const lastDayTimestamp = nextMonthFirstDay.getTime() - 1
  const stamp = Math.floor(lastDayTimestamp / 1000)
  return stamp
}

function getFirstDayTimestamp(obj) {
  let { year, month } = obj
  const firstDay = new Date(year, parseInt(month) - 1, 1)
  firstDay.setHours(0, 0, 0, 0)
  const firstDayTimestamp = firstDay.getTime()
  let stamp = Math.floor(firstDayTimestamp / 1000)
  return stamp
}

const fetchLongText = async function (postid) {
  let longTextResp = await axios.get(GetLongTextURL, {
    params: {
      id: postid,
    },
  })

  try {
    return longTextResp?.data?.data || ""
  } catch (error) {
    return
  }
}

export const fetchPost = async function (parameters, callback) {
  resetState()
  _callback = callback

  generateHTML()

  let { uid, sourceType, sortType = 0, rangeType, range } = parameters

  _uid = uid
  _sourceType = sourceType

  let requestParam = {
    uid,
    page,
    feature: 4,
  }
  if (rangeType == 1) {
    requestParam = {
      ...requestParam,
      starttime: getFirstDayTimestamp(range.start),
      endtime: getLastDayTimestamp(range.end),
    }
  }

  let posts = []

  while (loadMore) {
    requestParam.page = page
    let respData = await doFetch(requestParam)

    if (!respData) {
      console.log("接口报错了")
    } else {
      if (respData?.list?.length > 0) {
        total = respData.total
        const formattedPosts = await formatPosts(respData.list, uid)
        posts = posts.concat(formattedPosts)
        console.log("继续拉")
      } else {
        loadMore = false
        console.log("数据拉完了")
      }
    }
    page++
  }

  const sortedPosts = sortPosts(posts, sortType)
  renderPosts(sortedPosts)

  return {
    posts: sortedPosts,
    total,
  }
}
